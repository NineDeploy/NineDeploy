import type { DB } from '@ninedeploy/db';
import { decrypt, encrypt } from './crypto.js';
import { getSettingString, setSettingString } from './settings.js';

/**
 * Cloudflare DNS-record management (zero-dependency: plain fetch + Bearer).
 * When enabled, adding a domain creates the matching DNS record pointing at
 * this server automatically; deleting the domain removes it again.
 */

const API = 'https://api.cloudflare.com/client/v4';

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ message: string }>;
  result: T;
}

async function cf<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as CfResponse<T>;
  if (!res.ok || !body.success) {
    throw new Error(`Cloudflare API error: ${body.errors?.map((e) => e.message).join('; ') || res.status}`);
  }
  return body.result;
}

export interface DnsRecordsConfig {
  enabled: boolean;
  token: string | null;
  /** Record content: an IPv4 address for A records, or a hostname for CNAME. */
  content: string | null;
}

export async function getDnsRecordsConfig(db: DB): Promise<DnsRecordsConfig> {
  const [provider, tokenEnc, content] = await Promise.all([
    getSettingString(db, 'dns_records_provider', null),
    getSettingString(db, 'dns_records_token_encrypted', null),
    getSettingString(db, 'dns_records_content', null),
  ]);
  return {
    enabled: provider === 'cloudflare' && !!tokenEnc,
    token: tokenEnc ? decrypt(tokenEnc) : null,
    content,
  };
}

export async function setDnsRecordsConfig(
  db: DB,
  cfg: { enabled: boolean; token?: string; content: string | null },
): Promise<void> {
  await setSettingString(db, 'dns_records_provider', cfg.enabled ? 'cloudflare' : '');
  if (cfg.token !== undefined) {
    await setSettingString(db, 'dns_records_token_encrypted', cfg.token ? encrypt(cfg.token) : '');
  }
  await setSettingString(db, 'dns_records_content', cfg.content ?? '');
}

/** Verify the API token (connectivity test). */
export async function testCloudflareToken(token: string): Promise<string> {
  const result = await cf<{ status: string }>('/user/tokens/verify', token);
  return result.status;
}

/** Resolve a hostname's zone: prefer exact match, then the longest suffix match. */
export async function findZoneId(token: string, hostname: string): Promise<string | null> {
  const zones = await cf<Array<{ id: string; name: string }>>('/zones?per_page=50', token);
  const exact = zones.find((z) => hostname === z.name || hostname.endsWith(`.${z.name}`));
  return exact?.id ?? null;
}

/** Detect this host's public IPv4 (used when no explicit record content is set). */
export async function detectPublicIp(): Promise<string> {
  const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { ip?: string };
  if (!body.ip) throw new Error('Could not detect public IP');
  return body.ip;
}

/**
 * Create the DNS record for a service hostname. Type is A when the content
 * looks like an IPv4 address, CNAME otherwise. Returns the record id.
 */
export async function createDnsRecord(
  token: string,
  hostname: string,
  content: string,
): Promise<string> {
  const zoneId = await findZoneId(token, hostname);
  if (!zoneId) throw new Error(`No Cloudflare zone matches ${hostname}`);
  const type = /^\d{1,3}(\.\d{1,3}){3}$/.test(content) ? 'A' : 'CNAME';
  const record = await cf<{ id: string }>(`/zones/${zoneId}/dns_records`, token, {
    method: 'POST',
    body: JSON.stringify({ type, name: hostname, content, ttl: 1, proxied: false }),
  });
  return record.id;
}

/** Delete a previously created record (best-effort — its zone is re-derived). */
export async function deleteDnsRecord(token: string, hostname: string, recordId: string): Promise<void> {
  const zoneId = await findZoneId(token, hostname);
  if (!zoneId) return;
  await cf(`/zones/${zoneId}/dns_records/${recordId}`, token, { method: 'DELETE' }).catch(() => undefined);
}
