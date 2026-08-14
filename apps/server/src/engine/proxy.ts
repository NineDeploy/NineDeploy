import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { domains, services, type DB } from '@ninedeploy/db';
import { config } from '../config.js';
import { capture, run, sleep } from '../lib/exec.js';
import { getSettingString } from '../lib/settings.js';

const TRAEFIK_CONTAINER = 'ninedeploy-traefik';
const TRAEFIK_IMAGE = 'traefik:v3.3';

/** Shared Docker network that app + database containers join to reach each other. */
export const NETWORK = 'ninedeploy';

/**
 * Whitelists for Traefik rule operands. Hostnames may contain DNS chars plus a
 * leading wildcard (`*.example.com`); paths may contain URL-safe chars. Anything
 * else — backticks, `)`, newlines, braces — is stripped so a crafted hostname or
 * path can never break out of the `Host(...)`/`PathPrefix(...)` rule or inject
 * arbitrary YAML into the dynamic config.
 */
const HOST_RE = /[^A-Za-z0-9.\-*]/g;
const PATH_RE = /[^A-Za-z0-9.\-/_]/g;

/** Atomically replace `file`'s contents: write to a sibling temp file then rename. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

/** Ensure the shared `ninedeploy` network exists (idempotent). */
export async function ensureNetwork(log: (line: string) => void): Promise<void> {
  try {
    const list = await capture('docker', ['network', 'ls', '--filter', `name=^${NETWORK}$`, '--format', '{{.Name}}']);
    if (list.includes(NETWORK)) return;
    await run('docker', ['network', 'create', NETWORK], {}, log);
    log(`network '${NETWORK}' created`);
  } catch (err) {
    log(`network warning: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Render the Traefik static config. When an ACME email is configured, a
 * Let's Encrypt resolver is attached to the `websecure` entry point via the
 * HTTP-01 challenge on :80 — this is what lets the per-domain SSL toggle issue
 * real certificates. Without an email the resolver is omitted so an
 * unconfigured instance keeps working (routing still functions; `ssl` domains
 * fall back to Traefik's default self-signed certificate).
 */
function renderStaticConfig(acmeEmail: string | null): string {
  const acme = acmeEmail
    ? `certificatesResolvers:
  letsencrypt:
    acme:
      email: ${acmeEmail}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
`
    : '';
  return `# Managed by NineDeploy — do not edit by hand.
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
providers:
  file:
    filename: /etc/traefik/dynamic.yml
    watch: true
api:
  dashboard: false
log:
  level: INFO
accessLog: {}
${acme}`;
}

/** Path helpers for the Traefik config directory under the data dir. */
const dir = () => path.join(config.paths.dataDir, 'traefik');
const staticPath = () => path.join(dir(), 'traefik.yml');
const dynamicPath = () => path.join(dir(), 'dynamic.yml');
// ACME account key + issued certificates live here; persisted under the data
// dir so renewals survive container recreates.
const acmePath = () => path.join(dir(), 'acme.json');

/**
 * Resolve the ACME account email: the DB setting (Settings → Security) wins,
 * with the `NINEDEPLOY_ACME_EMAIL` env var as the backward-compatible default.
 * Never throws — a missing settings table must not break config generation.
 */
export async function getAcmeEmail(db: DB): Promise<string | null> {
  try {
    return (await getSettingString(db, 'acme_email', null)) ?? config.acmeEmail ?? null;
  } catch {
    return config.acmeEmail ?? null;
  }
}

export interface CertificateInfo {
  domain: string;
  expiresAt: Date | null;
}

/**
 * Extract the newest ASN.1 UTCTime from a PEM certificate. A cert's Validity
 * block contains exactly two UTCTimes (notBefore, notAfter) as plain ASCII
 * `YYMMDDHHMMSSZ` runs inside the DER bytes; the max is always notAfter.
 */
export function parseCertExpiry(pem: string): Date | null {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  // Buffer.from(base64) never throws — invalid chars are skipped; an all-junk
  // input just decodes to zero bytes, handled below.
  const der = Buffer.from(body, 'base64');
  if (der.length === 0) return null;
  let best: Date | null = null;
  for (let i = 0; i + 13 <= der.length; i++) {
    if (der[i + 12] !== 0x5a /* 'Z' */) continue;
    const run = der.subarray(i, i + 13).toString('latin1');
    if (!/^\d{12}Z$/.test(run)) continue;
    const nums = [run.slice(0, 2), run.slice(2, 4), run.slice(4, 6), run.slice(6, 8), run.slice(8, 10), run.slice(10, 12)].map(Number) as [number, number, number, number, number, number];
    const [yy, mm, dd, hh, mi, ss] = nums;
    // RFC 5280: years 00-49 → 20xx, 50-99 → 19xx.
    const year = yy + (yy < 50 ? 2000 : 1900);
    // Any 12 digits yield a finite Date (out-of-range fields roll over), so
    // no NaN guard is needed here.
    const date = new Date(Date.UTC(year, mm - 1, dd, hh, mi, ss));
    if (!best || date > best) best = date;
  }
  return best;
}

/**
 * Read the issued certificates out of Traefik's acme.json storage.
 * Shape: { <resolver>: { Certificates: [{ domain: { main }, certificate: PEM }] } }.
 * Returns [] when ACME is unused or the file is absent/corrupt.
 */
export function readCertificates(): CertificateInfo[] {
  try {
    if (!existsSync(acmePath())) return [];
    const raw = JSON.parse(readFileSync(acmePath(), 'utf-8')) as Record<
      string,
      { Certificates?: Array<{ domain?: { main?: string }; certificate?: string }> }
    >;
    const out: CertificateInfo[] = [];
    for (const resolver of Object.values(raw)) {
      for (const cert of resolver.Certificates ?? []) {
        const domain = cert.domain?.main;
        if (!domain || !cert.certificate) continue;
        out.push({ domain, expiresAt: parseCertExpiry(cert.certificate) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Whether `container` is attached to `network`. */
async function onNetwork(container: string, network: string): Promise<boolean> {
  try {
    const out = await capture('docker', ['inspect', container, '--format', '{{json .NetworkSettings.Networks}}']);
    return out.includes(`"${network}"`);
  } catch {
    return false;
  }
}

/** Ensure the Traefik reverse-proxy container is running on the shared network (idempotent). */
export async function ensureTraefik(log: (line: string) => void, acmeEmail: string | null = config.acmeEmail ?? null): Promise<void> {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(staticPath(), renderStaticConfig(acmeEmail));
  if (!existsSync(dynamicPath())) writeFileSync(dynamicPath(), 'http:\n  routers:\n  services:\n');
  if (acmeEmail && !existsSync(acmePath())) {
    // Seed the ACME storage file so the bind mount below is a FILE and not an
    // auto-created directory (Docker creates a directory when the host path of
    // a bind mount does not exist, which would break Traefik).
    writeFileSync(acmePath(), '{}', { mode: 0o600 });
  }

  try {
    const running = (await capture('docker', ['ps', '-q', '-f', `name=^${TRAEFIK_CONTAINER}$`])).trim();
    if (running && (await onNetwork(TRAEFIK_CONTAINER, NETWORK))) {
      log('traefik already running on shared network');
      return;
    }
    // Recreate so it joins the network (the only publicly exposed service).
    await run('docker', ['rm', '-f', TRAEFIK_CONTAINER], {}, () => {}).catch(() => undefined);

    log('starting traefik container …');
    // Mount the whole config DIRECTORY, not the individual files. A single-file
    // bind mount pins the inode at container start, so our atomic config update
    // (temp file + rename → new inode) would never be seen by the container on
    // Linux — Traefik would silently keep reading the original file forever.
    // With a directory mount, the rename is visible and the file watcher fires.
    const runArgs = [
      'run', '-d', '--name', TRAEFIK_CONTAINER, '--restart', 'unless-stopped',
      '--network', NETWORK,
      '-p', '80:80', '-p', '443:443',
      '-v', `${dir()}:/etc/traefik:ro`,
    ];
    if (acmeEmail) {
      // ACME needs a writable storage file for the account key + certificates.
      // Mount just that single file read-write (Traefik writes it; we never
      // atomically rename it, so the pinned-inode caveat does not apply) while
      // keeping the config directory read-only.
      runArgs.push('-v', `${acmePath()}:/etc/traefik/acme.json`);
    }
    runArgs.push(TRAEFIK_IMAGE);
    await run(
      'docker',
      runArgs,
      {},
      log,
    );
    await sleep(1000);
    log('traefik started (http :80 / https :443) on shared network');
  } catch (err) {
    log(`traefik warning: ${err instanceof Error ? err.message : err}`);
    log('domain routing will be unavailable until traefik can bind :80/:443');
  }
}

/**
 * Regenerate the Traefik dynamic config from the DB: one router+service per
 * domain pointing at the service's published port. Called after deploys and
 * domain changes.
 */
export async function writeDynamicConfig(db: DB): Promise<void> {
  const all = await db.select().from(domains);
  const servicesById = new Map(
    (await db.select().from(services)).map((s) => [s.id, s]),
  );
  const acmeEmail = await getAcmeEmail(db);

  const routers: string[] = [];
  const svcBlocks: string[] = [];
  const seen = new Set<string>();

  for (const d of all) {
    const svc = servicesById.get(d.serviceId);
    if (!svc || !svc.port || !svc.runtimeId) continue; // need a running container to route to
    const key = `${svc.slug}_${d.id}`;
    // Sanitize operands against rule/YAML injection (see HOST_RE/PATH_RE).
    const host = String(d.hostname ?? '').replace(HOST_RE, '');
    if (!host) continue; // every char was stripped → the hostname is unusable/unsafe
    const cleanPath = String(d.path ?? '').replace(PATH_RE, '');
    const entry = d.ssl ? 'websecure' : 'web';
    // TLS routers reference the ACME resolver when automatic HTTPS is enabled;
    // otherwise keep the old behavior (Traefik's default self-signed cert).
    const tlsBlock = d.ssl
      ? acmeEmail
        ? '\n      tls:\n        certResolver: letsencrypt'
        : '\n      tls: {}'
      : '';
    routers.push(
      `    ${key}:\n` +
        `      rule: "Host(\`${host}\`)${cleanPath && cleanPath !== '/' ? ` && PathPrefix(\`${cleanPath}\`)` : ''}"\n` +
        `      service: svc_${key}\n` +
        `      entryPoints:\n        - ${entry}` +
        tlsBlock,
    );
    if (!seen.has(`svc_${key}`)) {
      seen.add(`svc_${key}`);
      svcBlocks.push(
        `    svc_${key}:\n` +
          `      loadBalancer:\n` +
          `        servers:\n` +
          `          - url: "http://${svc.runtimeId}:${svc.port}"`,
      );
    }
  }

  const yaml =
    '# Managed by NineDeploy — regenerated on deploy/domain changes.\n' +
    'http:\n' +
    '  routers:\n' +
    (routers.length ? routers.join('\n') + '\n' : '    {}\n') +
    '  services:\n' +
    (svcBlocks.length ? svcBlocks.join('\n') + '\n' : '    {}\n');

  writeAtomic(dynamicPath(), yaml);
}
