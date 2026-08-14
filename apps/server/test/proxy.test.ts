import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { domains, services } from '@ninedeploy/db';
import { ensureNetwork, ensureTraefik, NETWORK, writeDynamicConfig } from '../src/engine/proxy.js';

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
