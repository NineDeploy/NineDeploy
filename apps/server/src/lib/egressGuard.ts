import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * L-11: refuse outbound requests aimed at the host's own network.
 *
 * Several settings are operator-supplied URLs the server then fetches:
 * notification webhooks, the OIDC issuer, the S3 backup endpoint and
 * `templates_source`. They are admin-only, so this is not a privilege
 * escalation — but "admin" in a PaaS is not the same trust level as "the
 * process's network position". The panel sits inside the Docker network with
 * every managed container, and on a cloud VM it can reach the instance
 * metadata service. A webhook URL is therefore a way to turn a settings field
 * into a request from a trusted source: `http://169.254.169.254/…` returns IAM
 * credentials on AWS/GCP/Azure, and `http://ninedeploy-db:5432` or
 * `http://127.0.0.1:<panel port>` reaches services that are unreachable from
 * the internet by design.
 *
 * What this does NOT solve: DNS rebinding. The name is resolved here and
 * resolved again by `fetch`, so a hostile resolver can answer differently the
 * second time. Closing that needs a connect-time hook on the HTTP agent, which
 * global `fetch` does not expose. Given these URLs are admin-entered, the
 * remaining exposure is an admin attacking their own instance.
 *
 * Escape hatch: many self-hosters legitimately point a webhook at a receiver
 * on the same LAN. `NINEDEPLOY_ALLOW_PRIVATE_EGRESS=1` turns the check off.
 */

/** Private, loopback, link-local and other non-routable IPv4 space. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments / 192.0.0.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Loopback, unique-local, link-local and IPv4-mapped IPv6. */
function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? '';
  if (addr === '::' || addr === '::1') return true;
  // IPv4-mapped (::ffff:169.254.169.254) — judge the embedded IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^ff/.test(addr)) return true; // multicast
  return false;
}

/** True when the literal address is one this server must not dial. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not an IP at all — caller should have resolved it first
}

export function privateEgressAllowed(): boolean {
  return process.env['NINEDEPLOY_ALLOW_PRIVATE_EGRESS'] === '1';
}

export class EgressBlockedError extends Error {
  constructor(target: string, reason: string) {
    super(
      `Refusing to send an outbound request to ${target}: ${reason}. Set NINEDEPLOY_ALLOW_PRIVATE_EGRESS=1 if this instance really must reach internal addresses.`,
    );
    this.name = 'EgressBlockedError';
  }
}

/**
 * Throw unless `raw` is an http(s) URL that resolves to a public address.
 * Every resolved address must be public — a name with both a public and a
 * private answer is rejected, since which one `fetch` picks is not ours.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressBlockedError(raw, 'it is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressBlockedError(raw, `the ${url.protocol} scheme is not allowed`);
  }
  if (privateEgressAllowed()) return url;

  // `new URL` keeps IPv6 literals in brackets.
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new EgressBlockedError(raw, `${host} is a private or link-local address`);
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new EgressBlockedError(raw, `the hostname ${host} could not be resolved`);
  }
  if (addresses.length === 0) throw new EgressBlockedError(raw, `the hostname ${host} resolved to no addresses`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new EgressBlockedError(raw, `${host} resolves to the private address ${address}`);
    }
  }
  return url;
}

/** `fetch`, refusing anything that points inside the host's own network. */
export async function guardedFetch(raw: string, init?: RequestInit): Promise<Response> {
  await assertPublicHttpUrl(raw);
  return fetch(raw, init);
}
