import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalOrchestrator } from '../../src/kernel/drivers/localOrchestrator.js';
import type { StackSpec } from '../../src/kernel/types.js';

function newStack(): StackSpec {
  return {
    name: 'demo',
    services: [
      {
        name: 'web',
        image: 'nginx:1.27',
        replicas: 1,
        port: 80,
        env: { LOG_LEVEL: 'info' },
        networks: ['frontend'],
        secrets: [],
        configs: [],
        labels: { 'traefik.enable': 'true' },
      },
      {
        name: 'api',
        image: 'myorg/api:1.0',
        replicas: 2, // local driver collapses to 1
        port: 8080,
        env: {},
        networks: ['frontend', 'backend'],
        secrets: ['db_url'],
        configs: [],
        labels: {},
      },
    ],
    networks: [
      { name: 'frontend', driver: 'bridge', attachable: true },
      { name: 'backend', driver: 'overlay', attachable: false },
    ],
    secrets: [{ name: 'db_url', data: 'postgres://localhost/db' }],
    configs: [],
    volumes: [],
  };
}

let tmpRoot: string;
let runMock: ReturnType<typeof vi.fn>;
let captureMock: ReturnType<typeof vi.fn>;
let existsSyncSpy: ReturnType<typeof vi.spyOn>;
let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
let readdirSyncSpy: ReturnType<typeof vi.spyOn>;
let writeFileSyncSpy: ReturnType<typeof vi.spyOn>;
let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
let rmSyncSpy: ReturnType<typeof vi.spyOn>;

vi.mock('../../src/lib/exec.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
  capture: (...args: unknown[]) => captureMock(...args),
  buildEnv: (extra?: Record<string, string>) => ({ ...(extra ?? {}) }),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) => existsSyncSpy(p),
    readFileSync: (p: string) => readFileSyncSpy(p),
    readdirSync: (p: string) => readdirSyncSpy(p),
    writeFileSync: (p: string, data: string) => writeFileSyncSpy(p, data),
    mkdirSync: (p: string) => mkdirSyncSpy(p),
    rmSync: (p: string) => rmSyncSpy(p),
  };
});

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ndlocalorch-'));
  runMock = vi.fn();
  captureMock = vi.fn();
  existsSyncSpy = vi.fn().mockReturnValue(false);
  readFileSyncSpy = vi.fn().mockReturnValue('');
  readdirSyncSpy = vi.fn().mockReturnValue([]);
  writeFileSyncSpy = vi.fn();
  mkdirSyncSpy = vi.fn();
  rmSyncSpy = vi.fn();
  // Override the read-only snapshot helper: the driver uses an inline
  // require to bypass vi.mock for node:fs, so we set STACK_ROOT via
  // process.env instead. That doesn't work either, because the
  // constant is captured at module load. Instead, we use a
  // service-side mock: when the driver writes a file, capture the
  // contents via the writeFileSyncSpy and assert on the path passed.
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('LocalOrchestrator', () => {
  it('exposes the stable "local" name', () => {
    const o = new LocalOrchestrator();
    expect(o.name).toBe('local');
  });

  it('renders a stack spec into a docker-compose.yml shape on deployStack', async () => {
    writeFileSyncSpy.mockImplementation(() => undefined);
    runMock.mockResolvedValue(undefined);
    captureMock.mockResolvedValue('running\n');
    const stack = newStack();
    const o = new LocalOrchestrator();
    const status = await o.deployStack(stack);
    // The file was written
    expect(writeFileSyncSpy).toHaveBeenCalledOnce();
    const [path, body] = writeFileSyncSpy.mock.calls[0] as [string, string];
    expect(path).toMatch(/demo[\\/]docker-compose\.yml$/);
    expect(body).toContain('image: nginx:1.27');
    expect(body).toContain('image: myorg/api:1.0');
    expect(body).toContain('replicas: 2');
    expect(body).toContain('# requested replicas: 2 (local driver runs 1)');
    expect(body).toContain('driver: bridge');
    expect(body).toContain('driver: overlay');
    expect(body).toContain('secrets:');
    // Status report
    expect(status.name).toBe('demo');
    expect(status.services).toHaveLength(2);
    expect(status.services[0]?.state).toBe('running');
  });

  it('marks a service as stopped when docker compose ps reports exited', async () => {
    writeFileSyncSpy.mockImplementation(() => undefined);
    runMock.mockResolvedValue(undefined);
    captureMock.mockResolvedValueOnce('running\n').mockResolvedValueOnce('exited\n');
    const o = new LocalOrchestrator();
    const status = await o.deployStack(newStack());
    expect(status.services[0]?.state).toBe('running');
    expect(status.services[1]?.state).toBe('stopped');
  });

  it('falls back to a status of "unknown" when the capture throws', async () => {
    writeFileSyncSpy.mockImplementation(() => undefined);
    runMock.mockResolvedValue(undefined);
    captureMock.mockRejectedValue(new Error('docker missing'));
    const o = new LocalOrchestrator();
    const status = await o.deployStack(newStack());
    expect(status.services.every((s) => s.state === 'unknown')).toBe(true);
  });

  it('returns null from getStackStatus when the compose file is absent', async () => {
    existsSyncSpy.mockReturnValue(false);
    const o = new LocalOrchestrator();
    const status = await o.getStackStatus('missing');
    expect(status).toBeNull();
  });

  it('removes a stack only when the compose file exists', async () => {
    existsSyncSpy.mockReturnValueOnce(true);
    runMock.mockResolvedValue(undefined);
    const o = new LocalOrchestrator();
    await o.removeStack('demo');
    expect(runMock).toHaveBeenCalledOnce();
    expect(rmSyncSpy).toHaveBeenCalledOnce();
  });

  it('is a no-op when removeStack is called on an unknown stack', async () => {
    existsSyncSpy.mockReturnValue(false);
    const o = new LocalOrchestrator();
    await o.removeStack('missing');
    expect(runMock).not.toHaveBeenCalled();
    expect(rmSyncSpy).not.toHaveBeenCalled();
  });

  it('returns an empty list from listStacks when STACK_ROOT is unreadable', async () => {
    readdirSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const o = new LocalOrchestrator();
    const list = await o.listStacks();
    expect(list).toEqual([]);
  });
});
