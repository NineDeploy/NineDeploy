import type { DB } from '@ninedeploy/db';
import { decrypt, encrypt } from './crypto.js';
import { getSettingString, setSettingString } from './settings.js';

/**
 * Vault-provider secret resolution (deploy-time). Env values may reference
 * external secret stores with the `${{provider:KEY}}` syntax; the reference is
 * resolved at deploy time and never stored. Zero-dependency: plain fetch.
 *
 * Providers: infisical (Machine Identity / Universal Auth token),
 * doppler (service token — Basic auth).
 */

export const vaultProviders = ['infisical', 'doppler'] as const;
export type VaultProvider = (typeof vaultProviders)[number];

export interface VaultConfig {
  provider: VaultProvider | null;
  token: string | null;
  /** Infisical workspace/project id + environment slug; Doppler project + config. */
  projectId: string | null;
  environment: string | null;
}

export async function getVaultConfig(db: DB): Promise<VaultConfig> {
  const provider = getSettingString(db, 'vault_provider', null);
  const tokenEncrypted = getSettingString(db, 'vault_token_encrypted', null);
  const projectId = getSettingString(db, 'vault_project_id', null);
  const environment = getSettingString(db, 'vault_environment', null);
  const [p, t, pi, e] = await Promise.all([provider, tokenEncrypted, projectId, environment]);
  if (!p || p !== 'infisical' && p !== 'doppler') return { provider: null, token: null, projectId: null, environment: null };
  return { provider: p, token: t ? decrypt(t) : null, projectId: pi, environment: e };
}

export async function setVaultConfig(
  db: DB,
  cfg: { provider: VaultProvider | null; token: string | null; projectId: string | null; environment: string | null },
): Promise<void> {
  await Promise.all([
    setSettingString(db, 'vault_provider', cfg.provider ?? ''),
    cfg.token === null
      ? setSettingString(db, 'vault_token_encrypted', '')
      : setSettingString(db, 'vault_token_encrypted', encrypt(cfg.token)),
    setSettingString(db, 'vault_project_id', cfg.projectId ?? ''),
    setSettingString(db, 'vault_environment', cfg.environment ?? ''),
  ]);
}

const INFISICAL_BASE = 'https://app.infisical.com/api/v3';
const DOPPLER_BASE = 'https://api.doppler.com/v3';

async function fetchInfisicalSecrets(cfg: VaultConfig): Promise<Record<string, string>> {
  const url = new URL(`${INFISICAL_BASE}/secrets/raw`);
  url.searchParams.set('workspaceId', cfg.projectId ?? '');
  url.searchParams.set('environment', cfg.environment ?? 'default');
  url.searchParams.set('secretPath', '/');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Infisical API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { secrets?: Array<{ secretKey: string; secretValue: string }> };
  const out: Record<string, string> = {};
  for (const s of body.secrets ?? []) out[s.secretKey] = s.secretValue;
  return out;
}

async function fetchDopplerSecrets(cfg: VaultConfig): Promise<Record<string, string>> {
  const url = new URL(`${DOPPLER_BASE}/configs/secrets/download`);
  url.searchParams.set('format', 'json');
  if (cfg.projectId) url.searchParams.set('project', cfg.projectId);
  url.searchParams.set('config', cfg.environment ?? 'dev');
  const basic = Buffer.from(`${cfg.token}:`).toString('base64');
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Doppler API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, string>;
}

/** Fetch the provider's full secret set (used for both resolution and testing). */
export async function fetchVaultSecrets(cfg: VaultConfig): Promise<Record<string, string>> {
  if (!cfg.provider || !cfg.token) throw new Error('No vault provider configured');
  if (cfg.provider === 'infisical') return fetchInfisicalSecrets(cfg);
  return fetchDopplerSecrets(cfg);
}

/** Connectivity test — returns the number of reachable secrets. */
export async function testVault(db: DB): Promise<number> {
  const cfg = await getVaultConfig(db);
  const secrets = await fetchVaultSecrets(cfg);
  return Object.keys(secrets).length;
}

// ── deploy-time resolution ─────────────────────────────────────────────────
// One shared regex; caching avoids re-parsing. Provider+key are both
// constrained ([\w.-]+) so a hostile value can't smuggle extra syntax.
const REF = /\$\{\{(infisical|doppler):([\w.-]+)\}\}/g;

/** True when the value contains at least one vault reference. */
export function hasVaultRef(value: string): boolean {
  REF.lastIndex = 0;
  return REF.test(value);
}

/**
 * Resolve every `${{provider:KEY}}` reference in an env map, in place of the
 * caller. Loads each referenced provider once (deploy-scoped cache). Missing
 * keys throw — a half-resolved secret leaking the raw reference into a
 * container is worse than a failed deploy.
 */
export async function resolveVaultRefs(
  db: DB,
  env: Record<string, string>,
): Promise<Record<string, string>> {
  const needed = new Map<VaultProvider, void>();
  for (const value of Object.values(env)) {
    REF.lastIndex = 0;
    for (const m of value.matchAll(REF)) needed.set(m[1] as VaultProvider);
  }
  if (needed.size === 0) return env;
  const pools = new Map<VaultProvider, Record<string, string>>();
  for (const provider of needed.keys()) {
    const cfg = await getVaultConfig(db);
    if (cfg.provider !== provider || !cfg.token) {
      throw new Error(`Vault provider "${provider}" is referenced but not configured`);
    }
    pools.set(provider, await fetchVaultSecrets(cfg));
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = value.replace(REF, (_all, provider: string, name: string) => {
      const pool = pools.get(provider as VaultProvider);
      const resolved = pool?.[name];
      if (resolved === undefined) throw new Error(`Vault secret "${provider}:${name}" not found (env key ${key})`);
      return resolved;
    });
  }
  return out;
}
