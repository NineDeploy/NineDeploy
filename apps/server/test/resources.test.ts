import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { systemRoutes } from '../src/modules/resources.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  run: vi.fn(async (_c: unknown, _a: unknown, _o: unknown, sink?: (l: string) => void) => { sink?.('out'); }),
}));
vi.mock('../src/lib/exec.js', () => execMocks);

// Mutable config so each test gets its own isolated data dir under os.tmpdir().
const configMock = vi.hoisted(() => ({
  wildcardDomain: '',
  isProd: false,
  publicUrl: 'http://localhost:3000',
  paths: {
    dataDir: '/tmp',
    dbFile: '/tmp/ninedeploy.db',
    masterKeyFile: '/tmp/master.key',
  },
}));
vi.mock('../src/config.js', () => ({ config: configMock }));

// The route's `finally` unlinks the archive immediately after reply.send() —
// a real stream would open the file after it is gone. Mock createReadStream so
// the export branch completes deterministically.
const fsMocks = vi.hoisted(() => ({
  createReadStream: vi.fn(() => 'mocked-archive-payload'),
}));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, createReadStream: fsMocks.createReadStream };
});

// Wrap the real child_process spawn so real tar runs, while tests can force
// failure via error/exit-code branches.
const spawnMock = vi.hoisted(() => ({
  force: { error: false, code: null as number | null },
  spawn: null as unknown as (...a: unknown[]) => unknown,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  spawnMock.spawn = real.spawn;
  return {
    ...real,
    spawn: (cmd: string, args: string[], opts?: unknown) => {
      if (spawnMock.force.error) {
        spawnMock.force.error = false;
        return fakeChild((emit) => { emit('error', new Error('spawn failed')); });
      }
      if (spawnMock.force.code !== null) {
        const code = spawnMock.force.code;
        spawnMock.force.code = null;
        return fakeChild((emit) => { emit('close', code); });
      }
      return real.spawn(cmd, args, opts);
    },
  };
});

type Emit = (ev: string, ...a: unknown[]) => void;
function fakeChild(trigger: (emit: Emit) => void) {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  const emit: Emit = (ev, ...a) => { for (const cb of handlers[ev] ?? []) cb(...a); };
  // Minimal stdout stream so consumers attaching 'data' listeners don't crash.
  const stdoutHandlers: Array<(...a: unknown[]) => void> = [];
  queueMicrotask(() => trigger(emit));
  return {
    on: (ev: string, cb: (...a: unknown[]) => void) => { (handlers[ev] ??= []).push(cb); },
    emit,
    stdout: { on: (ev: string, cb: (...a: unknown[]) => void) => { if (ev === 'data') stdoutHandlers.push(cb); } },
  };
}

const createdDirs: string[] = [];

function newDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-res-'));
  createdDirs.push(dir);
  configMock.paths.dataDir = dir;
  configMock.paths.dbFile = path.join(dir, 'ninedeploy.db');
  configMock.paths.masterKeyFile = path.join(dir, 'master.key');
  return dir;
}

function tar(dir: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnMock.spawn('tar', ['-czf', out, '-C', dir, '.']);
    child.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`tar ${code}`))));
    child.on('error', reject);
  });
}

/** Build a tar.gz archive from `dir` and return its raw bytes as a Buffer. */
async function makeArchive(dir: string): Promise<Buffer> {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-up-'));
  createdDirs.push(uploadDir);
  const archive = path.join(uploadDir, 'upload.tar.gz');
  await tar(dir, archive);
  return fs.readFileSync(archive);
}

async function appWith(fixtures: Record<string, unknown> = {}) {
  const app = await buildTestApp({ db: createFakeDb(fixtures as never), rawBody: true });
  await app.register(systemRoutes);
  return app;
}

describe('system resources routes', () => {
  beforeEach(() => {
    newDataDir();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports docker resources', async () => {
    execMocks.capture.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'system') {
        return Promise.resolve(
          '{"Type":"Images","Total":"3","Active":"2","Size":"1.2GB","Reclaimable":"300MB"}\n' +
            'not json\n' +
            '{"Type":"Containers","Total":"4"}\n',
        );
      }
      if (args[0] === 'images') {
        return Promise.resolve('nginx|latest|100MB\nredis|7|50MB\n');
      }
      if (args[0] === 'ps') return Promise.resolve('c1\nc2\n');
      return Promise.resolve('v1\nv2\nv3\n');
    });
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/resources', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      network: 'ninedeploy',
      containers: 2,
      volumes: 3,
      imagesSummary: { total: '3', active: '2', size: '1.2GB', reclaimable: '300MB' },
      images: [
        { repo: 'nginx', tag: 'latest', size: '100MB' },
        { repo: 'redis', tag: '7', size: '50MB' },
      ],
    });
  });

  it('falls back to defaults for sparse docker output', async () => {
    execMocks.capture.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'system') {
        return Promise.resolve('{"Type":"Images"}\n');
      }
      if (args[0] === 'images') {
        return Promise.resolve('repo-only\n|\n');
      }
      if (args[0] === 'ps') return Promise.resolve('');
      return Promise.resolve('');
    });
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/resources', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      containers: 0,
      volumes: 0,
      imagesSummary: { total: '0', active: '0', size: '—', reclaimable: '—' },
      images: [
        { repo: 'repo-only', tag: '', size: '' },
        { repo: '', tag: '', size: '' },
      ],
    });
  });

  it('falls back to defaults when docker is unavailable', async () => {
    execMocks.capture.mockRejectedValue(new Error('docker not found'));
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/resources', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      containers: 0,
      volumes: 0,
      imagesSummary: { total: '0', active: '0', size: '—', reclaimable: '—' },
      images: [],
    });
  });

  it('prunes images', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: '/prune-images', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(execMocks.run).toHaveBeenCalled();
  });

  it('prune succeeds even when docker fails', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('down'));
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: '/prune-images', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('exports system state as a tar.gz', async () => {
    const dir = configMock.paths.dataDir;
    fs.writeFileSync(configMock.paths.dbFile, 'db-bytes');
    fs.writeFileSync(configMock.paths.masterKeyFile, 'key-bytes');
    fs.mkdirSync(path.join(dir, 'traefik'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'traefik', 'dynamic.yml'), 'http: {}');
    const app = await appWith({
      counts: {
        services: [{ n: 2 }],
        databases: [{ n: 1 }],
        deployments: [{ n: 4 }],
        users: [{ n: 1 }],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/export', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/gzip');
    expect(res.headers['content-disposition']).toContain('ninedeploy-backup-');
    // Artifacts are cleaned up by the finally block.
    expect(fs.existsSync(path.join(dir, '_meta.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '_env'))).toBe(false);
  });

  it('includes the cwd .env file when present', async () => {
    const oldCwd = process.cwd();
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-cwd-'));
    createdDirs.push(cwdDir);
    try {
      process.chdir(cwdDir);
      fs.writeFileSync(path.join(cwdDir, '.env'), 'SECRET=1');
      const app = await appWith({ counts: {} });
      const res = await app.inject({ method: 'GET', url: '/export', headers: asUser() });
      expect(res.statusCode).toBe(200);
      expect(fs.existsSync(path.join(configMock.paths.dataDir, '_env'))).toBe(false);
    } finally {
      process.chdir(oldCwd);
    }
  });

  it('reports a 500 when tar fails', async () => {
    fs.writeFileSync(configMock.paths.dbFile, 'db');
    spawnMock.force.error = true;
    const app = await appWith({ counts: {} });
    const res = await app.inject({ method: 'GET', url: '/export', headers: asUser() });
    expect(res.statusCode).toBe(500);
  });

  it('reports a 500 when tar exits non-zero', async () => {
    fs.writeFileSync(configMock.paths.dbFile, 'db');
    spawnMock.force.code = 1;
    const app = await appWith({ counts: {} });
    const res = await app.inject({ method: 'GET', url: '/export', headers: asUser() });
    expect(res.statusCode).toBe(500);
  });

  it('rejects an import with no body', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: '/import', headers: asUser() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });

  it('rejects an archive without _meta.json', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    fs.writeFileSync(path.join(buildDir, 'hello.txt'), 'hi');
    const body = await makeArchive(buildDir);
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Invalid archive');
  });

  it('reports a 500 when tar extraction fails', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: Buffer.from('this is not a tar archive'),
    });
    expect(res.statusCode).toBe(500);
  });

  it('imports a full system state and stops the worker', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    const dir = configMock.paths.dataDir;
    fs.mkdirSync(path.join(dir, 'traefik'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'traefik', 'dynamic.yml'), 'old');
    fs.writeFileSync(path.join(dir, 'ninedeploy.db'), 'old-db');
    fs.writeFileSync(path.join(dir, 'master.key'), 'old-key');

    fs.writeFileSync(path.join(buildDir, '_meta.json'), JSON.stringify({ version: '1.0.0', stats: {} }));
    fs.writeFileSync(path.join(buildDir, 'ninedeploy.db'), 'new-db');
    fs.writeFileSync(path.join(buildDir, 'master.key'), 'new-key');
    fs.writeFileSync(path.join(buildDir, '_env'), 'NEW=1');
    fs.mkdirSync(path.join(buildDir, 'traefik'));
    fs.writeFileSync(path.join(buildDir, 'traefik', 'dynamic.yml'), 'new');

    const body = await makeArchive(buildDir);

    const app = await appWith();
    app.decorate('worker', { stop: vi.fn(async () => undefined) });
    const oldCwd = process.cwd();
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-cwd-'));
    createdDirs.push(cwdDir);
    try {
      process.chdir(cwdDir);
      const res = await app.inject({
        method: 'POST',
        url: '/import',
        headers: { 'content-type': 'application/octet-stream', ...asUser() },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, meta: { version: '1.0.0' } });
      expect(fs.readFileSync(configMock.paths.dbFile, 'utf8')).toBe('new-db');
      expect(fs.readFileSync(configMock.paths.masterKeyFile, 'utf8')).toBe('new-key');
      expect(fs.readFileSync(path.join(dir, 'traefik', 'dynamic.yml'), 'utf8')).toBe('new');
      expect(fs.existsSync(path.join(dir, '_import'))).toBe(false);
      const worker = (app as unknown as { worker: { stop: ReturnType<typeof vi.fn> } }).worker;
      expect(worker.stop).toHaveBeenCalled();
    } finally {
      process.chdir(oldCwd);
    }
  });

  it('imports a minimal archive without pre-existing state', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    fs.writeFileSync(path.join(buildDir, '_meta.json'), JSON.stringify({ version: '1.0.0', stats: {} }));
    fs.writeFileSync(path.join(buildDir, 'ninedeploy.db'), 'fresh-db');
    const body = await makeArchive(buildDir);

    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(fs.readFileSync(configMock.paths.dbFile, 'utf8')).toBe('fresh-db');
  });

  it('imports a metadata-only archive', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    fs.writeFileSync(path.join(buildDir, '_meta.json'), JSON.stringify({ version: '1.0.0', stats: {} }));
    const body = await makeArchive(buildDir);

    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(fs.existsSync(configMock.paths.dbFile)).toBe(false);
  });

  it('rejects an archive with path-traversal members (tar-slip)', async () => {
    // Build a real archive whose member is renamed to `../evil` via --transform.
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-slip-'));
    createdDirs.push(uploadDir);
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-slip-stage-'));
    createdDirs.push(staging);
    fs.writeFileSync(path.join(staging, 'payload'), 'x');
    const archive = path.join(uploadDir, 'evil.tar.gz');
    await new Promise<void>((resolve, reject) => {
      const child = spawnMock.spawn('tar', ['--transform', 's,payload,../evil-payload,', '-czf', archive, '-C', staging, 'payload']);
      child.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`tar ${code}`))));
      child.on('error', reject);
    });

    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: fs.readFileSync(archive),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('unsafe member');
    // The extraction dir is cleaned up.
    expect(fs.existsSync(path.join(configMock.paths.dataDir, '_import'))).toBe(false);
  });

  it('imports an archive with a master key into a fresh data dir', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    fs.writeFileSync(path.join(buildDir, '_meta.json'), JSON.stringify({ version: '1.0.0', stats: {} }));
    fs.writeFileSync(path.join(buildDir, 'master.key'), 'fresh-key');
    const body = await makeArchive(buildDir);

    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(configMock.paths.masterKeyFile, 'utf8')).toBe('fresh-key');
  });

  it('imports an archive with a traefik dir into a fresh data dir', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    fs.writeFileSync(path.join(buildDir, '_meta.json'), JSON.stringify({ version: '1.0.0', stats: {} }));
    fs.mkdirSync(path.join(buildDir, 'traefik'));
    fs.writeFileSync(path.join(buildDir, 'traefik', 'dynamic.yml'), 'http: {}');
    const body = await makeArchive(buildDir);

    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/import',
      headers: { 'content-type': 'application/octet-stream', ...asUser() },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(configMock.paths.dataDir, 'traefik', 'dynamic.yml'), 'utf8')).toBe('http: {}');
  });

  it('imports an archive with _env into a cwd that has an .env', async () => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-build-'));
    createdDirs.push(buildDir);
    fs.writeFileSync(path.join(buildDir, '_meta.json'), JSON.stringify({ version: '1.0.0', stats: {} }));
    fs.writeFileSync(path.join(buildDir, '_env'), 'NEW=1');
    const body = await makeArchive(buildDir);

    const oldCwd = process.cwd();
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-cwd-'));
    createdDirs.push(cwdDir);
    fs.writeFileSync(path.join(cwdDir, '.env'), 'OLD=1');
    try {
      process.chdir(cwdDir);
      const app = await appWith();
      const res = await app.inject({
        method: 'POST',
        url: '/import',
        headers: { 'content-type': 'application/octet-stream', ...asUser() },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(fs.readFileSync(path.join(cwdDir, '.env'), 'utf8')).toBe('NEW=1');
    } finally {
      process.chdir(oldCwd);
    }
  });
});
