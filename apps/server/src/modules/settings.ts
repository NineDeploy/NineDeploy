import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { getSetting, getSettingString, setSetting, setSettingString } from '../lib/settings.js';
import { invalidateTemplateCache } from '../templates/registry.js';
import { DNS_PROVIDERS, encryptDnsToken, writeDynamicConfig } from '../engine/proxy.js';
import { getVaultConfig, setVaultConfig, testVault } from '../lib/vault.js';
import { getDnsRecordsConfig, setDnsRecordsConfig, testCloudflareToken } from '../lib/cloudflare.js';
import { config } from '../config.js';
import { ALLOW_REGISTRATION_DEFAULT } from './auth.js';

const togglePatch = z.object({ enabled: z.boolean() });
const emailPatch = z.object({ email: z.union([z.string().email().max(254), z.literal('')]) });
const domainPatch = z.object({
  domain: z.union([z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/).max(255), z.literal('')]),
});
// A registry source is either an https URL, an absolute filesystem path, or
// empty (= use the bundled registry).
const sourcePatch = z.object({ source: z.union([z.url().startsWith('https://'), z.string().regex(/^\//), z.literal('')]) });
// DNS-01 challenge config: provider from the supported list (or empty), an
// optional API token (omitted = keep the stored one), and an optional bare
// wildcard apex (e.g. example.com → *.example.com certificate).
const dnsPatch = z.object({
  provider: z.union([z.string().refine((p) => p === '' || p in DNS_PROVIDERS, 'Unsupported DNS provider'), z.literal('')]),
  token: z.string().min(1).max(4096).optional(),
  wildcardApex: z.union([z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/), z.literal('')]),
});
// Vault provider config: provider (or empty = off), optional token (omitted =
// keep stored), Infisical workspace id / Doppler project, environment slug.
const vaultPatch = z.object({
  provider: z.enum(['', 'infisical', 'doppler']),
  token: z.string().min(1).max(4096).optional(),
  projectId: z.union([z.string().max(255), z.literal('')]).optional(),
  environment: z.union([z.string().max(255), z.literal('')]).optional(),
});
// Cloudflare DNS-record provisioning: toggle + optional token (omitted = keep)
// + explicit record content (IPv4 → A, hostname → CNAME; empty = auto-detect).
const dnsRecordsPatch = z.object({
  enabled: z.boolean(),
  token: z.string().min(10).max(4096).optional(),
  content: z.union([z.string().max(255), z.literal('')]).optional(),
});

/**
 * Instance settings (admin-only). Mounted under /settings.
 * Exposes the open-registration toggle and the ACME (Let's Encrypt) email.
 */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => ({
    allowRegistration: await getSetting(app.db, 'allow_registration', ALLOW_REGISTRATION_DEFAULT),
    // Effective email: DB setting wins, env var is the fallback.
    acmeEmail: (await getSettingString(app.db, 'acme_email', null)) ?? config.acmeEmail ?? null,
    templatesSource: (await getSettingString(app.db, 'templates_source', null)) ?? config.templatesSource ?? null,
    // Read at request time (not import time) so env-only setups report it.
    dnsProvider: (await getSettingString(app.db, 'dns_provider', null)) ?? process.env['NINEDEPLOY_DNS_PROVIDER'] ?? null,
    // Read at request time (not import time) so env-only setups report true.
    hasDnsToken: (await getSettingString(app.db, 'dns_token_encrypted', null)) !== null || !!process.env['NINEDEPLOY_DNS_TOKEN'],
    // Read at request time (not import time) so env-only setups report it.
    wildcardApex: (await getSettingString(app.db, 'wildcard_domain', null)) ?? (process.env['NINEDEPLOY_WILDCARD_DOMAIN'] || null),
    panelDomain: (await getSettingString(app.db, 'panel_domain', null)) ?? process.env['NINEDEPLOY_DOMAIN'] ?? null,
  }));

  app.put('/panel-domain', async (req) => {
    const { domain } = domainPatch.parse(req.body);
    await setSettingString(app.db, 'panel_domain', domain);
    await writeDynamicConfig(app.db).catch(() => undefined);
    void audit(app.db, req.user!.id, 'settings.panel_domain', domain || 'cleared');
    return { ok: true, panelDomain: domain || null };
  });

  app.put('/allow-registration', async (req) => {
    const { enabled } = togglePatch.parse(req.body);
    await setSetting(app.db, 'allow_registration', enabled);
    void audit(app.db, req.user!.id, 'settings.registration', enabled ? 'enabled' : 'disabled');
    return { ok: true, allowRegistration: enabled };
  });

  app.put('/templates-source', async (req) => {
    const { source } = sourcePatch.parse(req.body);
    await setSettingString(app.db, 'templates_source', source);
    invalidateTemplateCache();
    void audit(app.db, req.user!.id, 'settings.templates', source || 'bundled');
    return { ok: true, templatesSource: source || null };
  });

  app.put('/dns', async (req) => {
    const input = dnsPatch.parse(req.body);
    await setSettingString(app.db, 'dns_provider', input.provider);
    if (input.token !== undefined) {
      await setSettingString(app.db, 'dns_token_encrypted', encryptDnsToken(input.token));
    }
    await setSettingString(app.db, 'wildcard_domain', input.wildcardApex);
    void audit(app.db, req.user!.id, 'settings.dns', `${input.provider || 'none'}${input.wildcardApex ? ` (*.${input.wildcardApex})` : ''}`);
    // Applied on next server start (the Traefik container is recreated then).
    return { ok: true, dnsProvider: input.provider || null, wildcardApex: input.wildcardApex || null, applied: 'restart' };
  });

  app.put('/acme-email', async (req) => {
    const { email } = emailPatch.parse(req.body);
    await setSettingString(app.db, 'acme_email', email);
    void audit(app.db, req.user!.id, 'settings.acme', email || 'cleared');
    // Applied on next server start (the Traefik container is recreated then).
    return { ok: true, acmeEmail: email || null, applied: 'restart' };
  });

  // ── Vault provider (deploy-time secret resolution) ───────────────────────
  app.get('/vault', async () => {
    const cfg = await getVaultConfig(app.db);
    return {
      provider: cfg.provider,
      hasToken: !!cfg.token,
      projectId: cfg.projectId,
      environment: cfg.environment,
    };
  });

  app.put('/vault', async (req) => {
    const input = vaultPatch.parse(req.body);
    const current = await getVaultConfig(app.db);
    await setVaultConfig(app.db, {
      provider: input.provider === '' ? null : input.provider,
      // Omitted token = keep the stored one; the others follow the payload.
      token: input.token ?? (input.provider === current.provider ? current.token : null),
      projectId: input.projectId ?? null,
      environment: input.environment ?? null,
    });
    void audit(app.db, req.user!.id, 'settings.vault', input.provider || 'disabled');
    return { ok: true, provider: input.provider || null };
  });

  app.post('/vault/test', async () => {
    const count = await testVault(app.db);
    return { ok: true, secrets: count };
  });

  // ── DNS records (Cloudflare auto-provisioning) ───────────────────────────
  app.get('/dns-records', async () => {
    const cfg = await getDnsRecordsConfig(app.db);
    return { enabled: cfg.enabled, hasToken: !!cfg.token, content: cfg.content };
  });

  app.put('/dns-records', async (req) => {
    const input = dnsRecordsPatch.parse(req.body);
    await setDnsRecordsConfig(app.db, {
      enabled: input.enabled,
      token: input.token,
      content: input.content || null,
    });
    void audit(app.db, req.user!.id, 'settings.dns_records', input.enabled ? 'cloudflare' : 'disabled');
    return { ok: true, enabled: input.enabled };
  });

  app.post('/dns-records/test', async () => {
    const cfg = await getDnsRecordsConfig(app.db);
    if (!cfg.token) return { ok: false, error: 'No Cloudflare token configured' };
    const status = await testCloudflareToken(cfg.token);
    return { ok: true, status };
  });
};
