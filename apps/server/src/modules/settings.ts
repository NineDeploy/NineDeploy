import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { getSetting, getSettingString, setSetting, setSettingString } from '../lib/settings.js';
import { invalidateTemplateCache } from '../templates/registry.js';
import { DNS_PROVIDERS, encryptDnsToken } from '../engine/proxy.js';
import { config } from '../config.js';

const togglePatch = z.object({ enabled: z.boolean() });
const emailPatch = z.object({ email: z.union([z.string().email().max(254), z.literal('')]) });
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

/**
 * Instance settings (admin-only). Mounted under /settings.
 * Exposes the open-registration toggle and the ACME (Let's Encrypt) email.
 */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => ({
    allowRegistration: await getSetting(app.db, 'allow_registration', true),
    // Effective email: DB setting wins, env var is the fallback.
    acmeEmail: (await getSettingString(app.db, 'acme_email', null)) ?? config.acmeEmail ?? null,
    templatesSource: (await getSettingString(app.db, 'templates_source', null)) ?? config.templatesSource ?? null,
    // Read at request time (not import time) so env-only setups report it.
    dnsProvider: (await getSettingString(app.db, 'dns_provider', null)) ?? process.env['NINEDEPLOY_DNS_PROVIDER'] ?? null,
    // Read at request time (not import time) so env-only setups report true.
    hasDnsToken: (await getSettingString(app.db, 'dns_token_encrypted', null)) !== null || !!process.env['NINEDEPLOY_DNS_TOKEN'],
    // Read at request time (not import time) so env-only setups report it.
    wildcardApex: (await getSettingString(app.db, 'wildcard_domain', null)) ?? (process.env['NINEDEPLOY_WILDCARD_DOMAIN'] || null),
  }));

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
};
