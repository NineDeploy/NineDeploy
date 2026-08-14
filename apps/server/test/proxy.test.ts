import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domains, services } from '@ninedeploy/db';
import { encryptDnsToken, ensureNetwork, ensureTraefik, getAcmeEmail, getDnsConfig, NETWORK, parseCertExpiry, readCertificates, renderStaticConfig, writeDynamicConfig } from '../src/engine/proxy.js';

const h = vi.hoisted(() => {
  const capture = vi.fn(async () => '');
  const run = vi.fn(async (_cmd: string, _args: unknown[], _opts: unknown, sink?: (line: string) => void) => {
    sink?.('');
  });
  const sleep = vi.fn(async () => undefined);
  const config: { paths: { dataDir: string }; acmeEmail: string | null } = {
    paths: { dataDir: '' },
    acmeEmail: null,
  };
  return { capture, run, sleep, config };
});

vi.mock('../src/lib/exec.js', () => ({ capture: h.capture, run: h.run, sleep: h.sleep }));
vi.mock('../src/config.js', () => ({ config: h.config }));

const base = mkdtempSync(path.join(os.tmpdir(), 'nd-proxy-'));
h.config.paths = { dataDir: base };
const traefikDir = path.join(base, 'traefik');

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Minimal self-signed-style PEM for parser tests: the DER contains two ASCII UTCTimes. */
function pemWithDates(notBefore: string, notAfter: string): string {
  // 0x17 = UTCTime tag; length 13; the timestamp as ASCII bytes.
  const body = Buffer.concat([
    Buffer.from([0x17, 13]), Buffer.from(notBefore, 'latin1'),
    Buffer.from([0x17, 13]), Buffer.from(notAfter, 'latin1'),
    Buffer.from([0xff, 0xfe, 0x5a]), // trailing non-timestamp bytes ending in 'Z'
  ]);
  return `-----BEGIN CERTIFICATE-----\n${body.toString('base64')}\n-----END CERTIFICATE-----\n`;
}

describe('certificate tracking', () => {
  beforeEach(() => {
    mkdirSync(traefikDir, { recursive: true });
  });

  it('parses the notAfter UTCTime out of a PEM certificate', () => {
    expect(parseCertExpiry(pemWithDates('260101000000Z', '270101000000Z'))).toEqual(new Date('2027-01-01T00:00:00Z'));
    // Equal timestamps exercise the not-newer branch.
    expect(parseCertExpiry(pemWithDates('270101000000Z', '270101000000Z'))).toEqual(new Date('2027-01-01T00:00:00Z'));
  });

  it('maps years 50-99 into the 1900s per RFC 5280', () => {
    expect(parseCertExpiry(pemWithDates('500101000000Z', '510101000000Z'))).toEqual(new Date('1951-01-01T00:00:00Z'));
  });

  it('returns null when nothing is configured anywhere', async () => {
    h.config.acmeEmail = null;
    const dbWithout = { query: { settings: { findFirst: async () => undefined } } };
    await expect(getAcmeEmail(dbWithout as never)).resolves.toBe(null);
  });

  it('keeps the newest of multiple parsed timestamps', () => {
    // notAfter in the past relative to notBefore — max() must still pick notBefore.
    expect(parseCertExpiry(pemWithDates('270101000000Z', '260101000000Z'))).toEqual(new Date('2027-01-01T00:00:00Z'));
  });

  it('returns null for a non-certificate or empty PEM', () => {
    expect(parseCertExpiry('not a pem')).toBeNull();
    expect(parseCertExpiry('-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----')).toBeNull();
  });

  it('reads issued certificates from acme.json', () => {
    const pem = pemWithDates('260101000000Z', '270101000000Z');
    writeFileSync(
      path.join(traefikDir, 'acme.json'),
      JSON.stringify({ letsencrypt: { Certificates: [{ domain: { main: 'app.example.com' }, certificate: pem }] } }),
    );
    const certs = readCertificates();
    expect(certs).toEqual([{ domain: 'app.example.com', expiresAt: new Date('2027-01-01T00:00:00Z') }]);
  });

  it('skips acme.json entries without a domain or certificate', () => {
    writeFileSync(
      path.join(traefikDir, 'acme.json'),
      JSON.stringify({
        letsencrypt: {
          Certificates: [
            { domain: { main: 'ok.example.com' }, certificate: pemWithDates('260101000000Z', '270101000000Z') },
            { domain: undefined, certificate: 'x' },
            { domain: { main: 'no-cert.example.com' } },
          ],
        },
        emptyResolver: {},
        otherResolver: { Certificates: [] },
      }),
    );
    const certs = readCertificates();
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ domain: 'ok.example.com' });
  });

  it('returns [] when acme.json is missing or corrupt', () => {
    rmSync(path.join(traefikDir, 'acme.json'), { force: true });
    expect(readCertificates()).toEqual([]);
    writeFileSync(path.join(traefikDir, 'acme.json'), '{not json');
    expect(readCertificates()).toEqual([]);
    writeFileSync(path.join(traefikDir, 'acme.json'), '{}');
    expect(readCertificates()).toEqual([]);
  });

  it('prefers the DB ACME email over the env fallback and never throws', async () => {
    h.config.acmeEmail = 'env@example.com';
    const dbWithEmail = { query: { settings: { findFirst: async () => ({ value: 'db@example.com' }) } } };
    await expect(getAcmeEmail(dbWithEmail as never)).resolves.toBe('db@example.com');
    const dbWithout = { query: { settings: { findFirst: async () => undefined } } };
    await expect(getAcmeEmail(dbWithout as never)).resolves.toBe('env@example.com');
    const brokenDb = { query: { settings: { findFirst: async () => { throw new Error('no table'); } } } };
    await expect(getAcmeEmail(brokenDb as never)).resolves.toBe('env@example.com');
    h.config.acmeEmail = null;
  });
});

const makeDb = (domainRows: unknown[], serviceRows: unknown[]) => ({
  select: vi.fn(() => ({
    from: vi.fn(async (t: unknown) => {
      if (t === domains) return domainRows;
      if (t === services) return serviceRows;
      return [];
    }),
  })),
});

describe('writeDynamicConfig', () => {
  beforeEach(() => {
    mkdirSync(traefikDir, { recursive: true });
  });

  it('generates routers and service blocks for domains pointing at running services', async () => {
    const db = makeDb(
      [
        { id: 1, serviceId: 1, hostname: 'app.example.com', path: '/', ssl: true },
        { id: 2, serviceId: 1, hostname: 'api.example.com', path: '/api', ssl: false },
      ],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml).toContain('rule: "Host(`app.example.com`)');
    expect(yaml).toContain('entryPoints:\n        - websecure');
    expect(yaml).toContain('tls: {}');
    expect(yaml).toContain('rule: "Host(`api.example.com`) && PathPrefix(`/api`)');
    expect(yaml).toContain('entryPoints:\n        - web');
    expect(yaml).toContain('svc_web_1:');
    expect(yaml).toContain('svc_web_2:');
    expect(yaml).toContain('url: "http://web-1:3000"');
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('skips domains whose service is missing or not runnable', async () => {
    const db = makeDb(
      [
        { id: 1, serviceId: 99, hostname: 'orphan.example.com', path: '/', ssl: false },
        { id: 2, serviceId: 3, hostname: 'noport.example.com', path: '/', ssl: false },
        { id: 3, serviceId: 2, hostname: 'noruntime.example.com', path: '/', ssl: false },
        { id: 4, serviceId: 1, hostname: 'ok.example.com', path: '/', ssl: false },
      ],
      [
        { id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' },
        { id: 2, slug: 'x', port: 3000, runtimeId: null },
        { id: 3, slug: 'y', port: null, runtimeId: 'y-1' },
      ],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml).toContain('ok.example.com');
    expect(yaml).not.toContain('orphan.example.com');
    expect(yaml).not.toContain('noport.example.com');
    expect(yaml).not.toContain('noruntime.example.com');
  });

  it('writes empty routers/services when there are no domains', async () => {
    const db = makeDb([], []);

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml).toContain('routers:\n    {}\n');
    expect(yaml).toContain('services:\n    {}\n');
  });

  it('dedupes identical service keys', async () => {
    const db = makeDb(
      [
        { id: 1, serviceId: 1, hostname: 'dup.example.com', path: '/', ssl: false },
        { id: 1, serviceId: 1, hostname: 'dup.example.com', path: '/', ssl: false },
      ],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml.match(/svc_web_1:/g)).toHaveLength(1);
  });

  it('propagates write failures', async () => {
    rmSync(traefikDir, { recursive: true, force: true });
    const db = makeDb(
      [{ id: 1, serviceId: 1, hostname: 'a.example.com', path: '/', ssl: false }],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await expect(writeDynamicConfig(db as never)).rejects.toThrow();
  });

  it('sanitizes hostile characters out of the hostname and path (rule/YAML injection)', async () => {
    const db = makeDb(
      [{ id: 1, serviceId: 1, hostname: 'evil`.example.com)inject', path: '/api`)breakout', ssl: false }],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    // Backticks, ')' and other unsafe chars are stripped; the safe remainder is kept.
    expect(yaml).toContain('Host(`evil.example.cominject`) && PathPrefix(`/apibreakout`)');
    expect(yaml).not.toMatch(/\)$/); // no unescaped ')' terminating a rule
  });

  it('skips a domain whose hostname is null or sanitizes to nothing', async () => {
    const db = makeDb(
      [
        { id: 1, serviceId: 1, hostname: null, path: '/', ssl: false },
        { id: 2, serviceId: 1, hostname: 'good.example.com', path: '/', ssl: false },
      ],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml).toContain('good.example.com');
    // Only one router survived (the null-hostname one was skipped).
    expect(yaml.match(/rule:/g)).toHaveLength(1);
  });

  it('omits PathPrefix when the path is null', async () => {
    const db = makeDb(
      [{ id: 1, serviceId: 1, hostname: 'app.example.com', path: null, ssl: false }],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml).toContain('Host(`app.example.com`)');
    expect(yaml).not.toContain('PathPrefix');
  });
});

describe('ensureNetwork', () => {
  it('does nothing when the network already exists', async () => {
    h.capture.mockResolvedValue(`${NETWORK}\n`);
    const log = vi.fn();

    await ensureNetwork(log);

    expect(h.run).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('creates the network when it is missing', async () => {
    h.capture.mockResolvedValue('');
    const log = vi.fn();

    await ensureNetwork(log);

    expect(h.run).toHaveBeenCalledWith('docker', ['network', 'create', NETWORK], {}, log);
    expect(log).toHaveBeenCalledWith(`network '${NETWORK}' created`);
  });

  it('logs a warning when listing networks fails with an Error', async () => {
    h.capture.mockRejectedValue(new Error('docker down'));
    const log = vi.fn();

    await ensureNetwork(log);

    expect(log).toHaveBeenCalledWith('network warning: docker down');
  });

  it('logs a warning when listing networks fails with a non-Error', async () => {
    h.capture.mockRejectedValue('boom');
    const log = vi.fn();

    await ensureNetwork(log);

    expect(log).toHaveBeenCalledWith('network warning: boom');
  });
});

describe('ensureTraefik', () => {
  const psWith = (ps: string, inspect = '{}') =>
    h.capture.mockImplementation((cmd: string, args: string[]) =>
      args[0] === 'ps' ? Promise.resolve(ps) : Promise.resolve(inspect),
    );

  beforeEach(() => {
    mkdirSync(traefikDir, { recursive: true });
    // Start each ensureTraefik test with no dynamic.yml so the bootstrap write
    // branch (the initial empty config) is exercised.
    rmSync(path.join(traefikDir, 'dynamic.yml'), { force: true });
  });

  it('writes static + dynamic config and returns early when traefik is on the network', async () => {
    psWith('abc123\n', '{"ninedeploy":{}}');
    const log = vi.fn();

    await ensureTraefik(log);

    expect(log).toHaveBeenCalledWith('traefik already running on shared network');
    expect(h.run).not.toHaveBeenCalled();
    expect(existsSync(path.join(traefikDir, 'traefik.yml'))).toBe(true);
    expect(existsSync(path.join(traefikDir, 'dynamic.yml'))).toBe(true);
  });

  it('recreates the container when it is running but off the network', async () => {
    psWith('abc123\n', '{"other":{}}');
    h.run.mockRejectedValueOnce(new Error('no such container')).mockResolvedValueOnce(undefined);
    const log = vi.fn();

    await ensureTraefik(log);

    expect(log).toHaveBeenCalledWith('starting traefik container …');
    expect(log).toHaveBeenCalledWith('traefik started (http :80 / https :443) on shared network');
    expect(h.sleep).toHaveBeenCalledWith(1000);
    expect(h.run).toHaveBeenCalledWith('docker', ['rm', '-f', 'ninedeploy-traefik'], {}, expect.any(Function));
    expect(h.run).toHaveBeenCalledWith(
      'docker',
      [
        'run', '-d', '--name', 'ninedeploy-traefik', '--restart', 'unless-stopped',
        '--network', NETWORK,
        '-p', '80:80', '-p', '443:443',
        // The whole config dir is mounted (single-file mounts pin the inode and
        // would never see atomic rename-based updates).
        '-v', `${traefikDir}:/etc/traefik:ro`,
        'traefik:v3.3',
      ],
      {},
      log,
    );
  });

  it('starts the container when none is running', async () => {
    psWith('', '{"ninedeploy":{}}');
    const log = vi.fn();

    await ensureTraefik(log);

    expect(log).toHaveBeenCalledWith('starting traefik container …');
    expect(log).toHaveBeenCalledWith('traefik started (http :80 / https :443) on shared network');
  });

  it('recreates when inspection fails', async () => {
    h.capture.mockImplementation((cmd: string, args: string[]) =>
      args[0] === 'ps' ? Promise.resolve('abc\n') : Promise.reject(new Error('inspect failed')),
    );
    const log = vi.fn();

    await ensureTraefik(log);

    expect(log).toHaveBeenCalledWith('starting traefik container …');
  });

  it('logs a warning when the ps command fails', async () => {
    h.capture.mockRejectedValue(new Error('docker down'));
    const log = vi.fn();

    await ensureTraefik(log);

    expect(log).toHaveBeenCalledWith('traefik warning: docker down');
    expect(log).toHaveBeenCalledWith('domain routing will be unavailable until traefik can bind :80/:443');
  });

  it('logs a warning when the ps command fails with a non-Error', async () => {
    h.capture.mockRejectedValue('boom');
    const log = vi.fn();

    await ensureTraefik(log);

    expect(log).toHaveBeenCalledWith('traefik warning: boom');
  });

  it('leaves an existing dynamic.yml untouched', async () => {
    writeFileSync(path.join(traefikDir, 'dynamic.yml'), '# keep me');
    psWith('abc\n', '{"ninedeploy":{}}');
    const log = vi.fn();

    await ensureTraefik(log);

    expect(readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8')).toBe('# keep me');
    expect(log).toHaveBeenCalledWith('traefik already running on shared network');
  });
});

describe("ACME / Let's Encrypt", () => {
  beforeEach(() => {
    mkdirSync(traefikDir, { recursive: true });
    rmSync(path.join(traefikDir, 'acme.json'), { force: true });
  });

  it('omits the ACME resolver from the static config when no email is configured', async () => {
    const psWith = (ps: string) =>
      h.capture.mockImplementation((cmd: string, args: string[]) =>
        args[0] === 'ps' ? Promise.resolve(ps) : Promise.resolve('{}'),
      );
    psWith('abc123\n');
    const log = vi.fn();

    await ensureTraefik(log);

    const yaml = readFileSync(path.join(traefikDir, 'traefik.yml'), 'utf8');
    expect(yaml).not.toContain('certificatesResolvers');
    expect(existsSync(path.join(traefikDir, 'acme.json'))).toBe(false);
  });

  it('writes a letsencrypt certificatesResolver when an email is configured', async () => {
    h.config.acmeEmail = 'ops@example.com';
    try {
      h.capture.mockImplementation((cmd: string, args: string[]) =>
        args[0] === 'ps' ? Promise.resolve('abc123\n') : Promise.resolve('{"ninedeploy":{}}'),
      );
      const log = vi.fn();

      await ensureTraefik(log);

      const yaml = readFileSync(path.join(traefikDir, 'traefik.yml'), 'utf8');
      expect(yaml).toContain('certificatesResolvers:');
      expect(yaml).toContain('letsencrypt:');
      expect(yaml).toContain('email: ops@example.com');
      expect(yaml).toContain('storage: /etc/traefik/acme.json');
      expect(yaml).toContain('httpChallenge:');
      expect(yaml).toContain('entryPoint: web');
      // acme.json is seeded so the bind mount is a FILE, not an auto-created dir.
      expect(existsSync(path.join(traefikDir, 'acme.json'))).toBe(true);
    } finally {
      h.config.acmeEmail = null;
    }
  });

  it('mounts acme.json read-write and keeps the config dir read-only', async () => {
    h.config.acmeEmail = 'ops@example.com';
    try {
      h.capture.mockImplementation((cmd: string, args: string[]) =>
        args[0] === 'ps' ? Promise.resolve('') : Promise.resolve('{}'),
      );
      // The stale-container rm is allowed to fail; the main run succeeds.
      h.run.mockRejectedValueOnce(new Error('no such container')).mockResolvedValueOnce(undefined);
      const log = vi.fn();

      await ensureTraefik(log);

      const runCall = h.run.mock.calls.find((c) => (c[1] as string[])[0] === 'run');
      expect(runCall).toBeDefined();
      const args = runCall![1] as string[];
      expect(args).toContain('-v');
      const dirIdx = args.indexOf('-v');
      expect(args[dirIdx + 1]).toBe(`${traefikDir}:/etc/traefik:ro`);
      expect(args).toContain(`${path.join(traefikDir, 'acme.json')}:/etc/traefik/acme.json`);
    } finally {
      h.config.acmeEmail = null;
    }
  });

  it('emits certResolver: letsencrypt on ssl routers when ACME is configured', async () => {
    h.config.acmeEmail = 'ops@example.com';
    try {
      const db = makeDb(
        [{ id: 1, serviceId: 1, hostname: 'app.example.com', path: '/', ssl: true }],
        [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
      );

      await writeDynamicConfig(db as never);

      const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
      expect(yaml).toContain('tls:\n        certResolver: letsencrypt');
      expect(yaml).not.toContain('tls: {}');
    } finally {
      h.config.acmeEmail = null;
    }
  });

  it('keeps tls: {} on ssl routers when ACME is not configured', async () => {
    const db = makeDb(
      [{ id: 1, serviceId: 1, hostname: 'app.example.com', path: '/', ssl: true }],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );

    await writeDynamicConfig(db as never);

    const yaml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yaml).toContain('tls: {}');
    expect(yaml).not.toContain('certResolver');
  });
});


describe('DNS-01 challenge (wildcard SSL)', () => {
  beforeEach(() => {
    mkdirSync(traefikDir, { recursive: true });
    rmSync(path.join(traefikDir, 'dns.env'), { force: true });
  });

  it('renders a dnsChallenge resolver when a provider+token are configured', () => {
    const yml = renderStaticConfig('ops@example.com', { provider: 'cloudflare', token: 'tok', wildcardApex: 'example.com' });
    expect(yml).toContain('dnsChallenge:');
    expect(yml).toContain('provider: cloudflare');
    expect(yml).not.toContain('httpChallenge:');
  });

  it('emits caServer when a staging directory is configured', () => {
    h.config.acmeCaServer = 'https://acme-staging-v02.api.letsencrypt.org/directory';
    const yml = renderStaticConfig('ops@example.com', null);
    expect(yml).toContain('caServer: https://acme-staging-v02.api.letsencrypt.org/directory');
    h.config.acmeCaServer = null;
    // Without the override the production directory is used implicitly.
    expect(renderStaticConfig('ops@example.com', null)).not.toContain('caServer:');
  });

  it('keeps httpChallenge without a DNS provider', () => {
    const yml = renderStaticConfig('ops@example.com', null);
    expect(yml).toContain('httpChallenge:');
    expect(yml).not.toContain('dnsChallenge:');

    // An unknown provider or a missing token also falls back to HTTP-01.
    const unknown = renderStaticConfig('ops@example.com', { provider: 'nope', token: 'tok', wildcardApex: null });
    expect(unknown).toContain('httpChallenge:');
    const tokenless = renderStaticConfig('ops@example.com', { provider: 'cloudflare', token: null, wildcardApex: null });
    expect(tokenless).toContain('httpChallenge:');
  });

  it('writes the provider token to a 0600 dns.env and passes --env-file to the container', async () => {
    h.config.acmeEmail = 'ops@example.com';
    await ensureTraefik(() => undefined, 'ops@example.com', { provider: 'cloudflare', token: 'sekrit', wildcardApex: 'example.com' });
    const envFile = path.join(traefikDir, 'dns.env');
    expect(readFileSync(envFile, 'utf8')).toBe('CF_DNS_API_TOKEN=sekrit\n');
    const args = h.run.mock.calls.at(-1)![1] as string[];
    const idx = args.indexOf('--env-file');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(envFile);
    h.config.acmeEmail = null;
  });

  it('skips the env file without a provider/token', async () => {
    h.config.acmeEmail = 'ops@example.com';
    await ensureTraefik(() => undefined, 'ops@example.com', null);
    expect(existsSync(path.join(traefikDir, 'dns.env'))).toBe(false);
    h.config.acmeEmail = null;
  });

  it('getDnsConfig prefers DB settings, decrypts the token, and normalizes the apex', async () => {
    const { encrypt } = await import('../src/lib/crypto.js');
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', 'b'.repeat(64));
    const values: Record<string, unknown> = {
      dns_provider: 'hetzner',
      dns_token_encrypted: encrypt('sekrit'),
      wildcard_domain: '*.example.com',
    };
    // getDnsConfig reads the three settings in a fixed order — answer each
    // lookup with its own value via a sequential mock.
    const ordered = [values['dns_provider'], values['dns_token_encrypted'], values['wildcard_domain']].map((value) => ({ value }));
    const db = {
      query: {
        settings: {
          findFirst: vi.fn()
            .mockResolvedValueOnce(ordered[0])
            .mockResolvedValueOnce(ordered[1])
            .mockResolvedValueOnce(ordered[2]),
        },
      },
    } as never;
    const result = await getDnsConfig(db);
    expect(result).toEqual({ provider: 'hetzner', token: 'sekrit', wildcardApex: 'example.com' });
    vi.unstubAllEnvs();
  });

  it('encryptDnsToken round-trips through the master-key envelope', async () => {
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', 'b'.repeat(64));
    const { decrypt } = await import('../src/lib/crypto.js');
    expect(decrypt(encryptDnsToken('roundtrip'))).toBe('roundtrip');
    vi.unstubAllEnvs();
  });

  it('does not leak the env token when the DB names a different provider', async () => {
    h.config.dnsProvider = 'cloudflare';
    h.config.dnsToken = 'cf-env-token';
    const db = {
      query: {
        settings: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({ value: 'hetzner' }) // dns_provider (DB wins)
            .mockResolvedValueOnce(undefined) // no stored token
            .mockResolvedValueOnce(undefined), // no stored apex
        },
      },
    } as never;
    const result = await getDnsConfig(db);
    expect(result.provider).toBe('hetzner');
    expect(result.token).toBeNull(); // env token belongs to cloudflare, not hetzner
    h.config.dnsProvider = null;
    h.config.dnsToken = null;
  });

  it('renderDnsEnvFile returns null without provider/token or for unknown providers', async () => {
    h.config.acmeEmail = 'ops@example.com';
    // No token → no env file, no --env-file flag.
    await ensureTraefik(() => undefined, 'ops@example.com', { provider: 'cloudflare', token: null, wildcardApex: null });
    expect(existsSync(path.join(traefikDir, 'dns.env'))).toBe(false);
    // Unknown provider → also skipped (falls back to HTTP-01).
    await ensureTraefik(() => undefined, 'ops@example.com', { provider: 'nope', token: 'tok', wildcardApex: null });
    expect(existsSync(path.join(traefikDir, 'dns.env'))).toBe(false);
    h.config.acmeEmail = null;
  });

  it('getDnsConfig falls back to env vars and never throws on db errors', async () => {
    h.config.dnsProvider = 'cloudflare';
    h.config.dnsToken = 'env-tok';
    h.config.wildcardDomain = '*.example.com';
    const noRows = { query: { settings: { findFirst: async () => undefined } } } as never;
    expect(await getDnsConfig(noRows)).toEqual({ provider: 'cloudflare', token: 'env-tok', wildcardApex: 'example.com' });
    const broken = { query: { settings: { findFirst: async () => { throw new Error('no table'); } } } } as never;
    expect(await getDnsConfig(broken)).toEqual({ provider: 'cloudflare', token: 'env-tok', wildcardApex: 'example.com' });
    h.config.dnsProvider = null;
    h.config.dnsToken = null;
    h.config.wildcardDomain = '';
  });

  it('writes a wildcard certificate block and HostRegexp routes for wildcard hosts', async () => {
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', 'b'.repeat(64));
    h.config.acmeEmail = 'ops@example.com';
    h.config.dnsProvider = 'cloudflare';
    h.config.dnsToken = 'tok';
    h.config.wildcardDomain = 'example.com';

    const db = makeDb(
      [
        { id: 1, serviceId: 1, hostname: '*.example.com', path: '/', ssl: true },
        { id: 2, serviceId: 1, hostname: 'plain.example.com', path: '/', ssl: true },
      ],
      [{ id: 1, slug: 'web', port: 3000, runtimeId: 'web-1' }],
    );
    await writeDynamicConfig(db as never);
    const yml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    // Wildcard host → HostRegexp with an escaped suffix.
    expect(yml).toContain('HostRegexp(`^[a-zA-Z0-9-]+\\.example\\.com$`)');
    // Plain host keeps the literal matcher.
    expect(yml).toContain('Host(`plain.example.com`)');
    // One wildcard cert for the apex, apex as SAN.
    expect(yml).toContain('main: "*.example.com"');
    expect(yml).toContain('- "example.com"');

    h.config.acmeEmail = null;
    h.config.dnsProvider = null;
    h.config.dnsToken = null;
    h.config.wildcardDomain = '';
    vi.unstubAllEnvs();
  });

  it('omits the wildcard block without DNS-01 readiness', async () => {
    h.config.acmeEmail = 'ops@example.com';
    h.config.dnsProvider = null; // no provider → HTTP-01 only
    h.config.wildcardDomain = 'example.com';
    await writeDynamicConfig(makeDb([], []) as never);
    const yml = readFileSync(path.join(traefikDir, 'dynamic.yml'), 'utf8');
    expect(yml).not.toContain('main: "*.example.com"');
    h.config.acmeEmail = null;
    h.config.wildcardDomain = '';
  });
});
