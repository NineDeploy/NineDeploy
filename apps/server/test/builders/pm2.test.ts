import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pm2Builder } from '../../src/engine/builders/pm2.js';

const h = vi.hoisted(() => {
  const pm2 = {
    connect: vi.fn((cb: (err?: Error | null) => void) => cb(null)),
    disconnect: vi.fn(),
    start: vi.fn((_opts: unknown, cb: (err?: Error | null) => void) => cb(null)),
    describe: vi.fn((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) => cb(null, [])),
    delete: vi.fn((_name: string, cb: (err?: Error | null) => void) => cb(null)),
  };
  const run = vi.fn(async () => undefined);
  const sleep = vi.fn(async () => undefined);
  return { pm2, run, sleep };
});

vi.mock('pm2', () => ({ default: h.pm2 }));
vi.mock('../../src/lib/exec.js', () => ({ run: h.run, sleep: h.sleep, capture: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

const makeCtx = (over: Record<string, unknown> = {}) => ({
  deploymentId: 2,
  service: { slug: 'api', port: 4000, healthPath: '/health' },
  buildConfig: { installCmd: 'npm ci', buildCmd: 'npm run build', startCmd: 'node dist/index.js' },
  workDir: '/work/api',
  commitSha: 'abc',
  env: { PORT: '4000' },
  log: vi.fn(),
  ...over,
});

describe('pm2Builder.buildAndRun', () => {
  it('runs install/build with the service env, stops the previous process and starts the app', async () => {
    const ctx = makeCtx();
    const previous = { runtimeId: 'api-1', port: null, healthPath: '/' };

    const runtime = await pm2Builder.buildAndRun(ctx as never, previous);

    expect(h.run).toHaveBeenNthCalledWith(1, 'sh', ['-c', 'npm ci'], { cwd: '/work/api', env: { PORT: '4000' } }, ctx.log);
    expect(h.run).toHaveBeenNthCalledWith(2, 'sh', ['-c', 'npm run build'], { cwd: '/work/api', env: { PORT: '4000' } }, ctx.log);
    expect(h.pm2.delete).toHaveBeenCalledWith('api-1', expect.any(Function));
    expect(h.pm2.start).toHaveBeenCalledWith(
      {
        name: 'api-2',
        script: 'node',
        args: 'dist/index.js',
        interpreter: 'none',
        cwd: '/work/api',
        autorestart: true,
        max_restarts: 10,
        env: { PORT: '4000' },
      },
      expect.any(Function),
    );
    expect(h.pm2.connect).toHaveBeenCalledTimes(2); // stop + start each connect once
    expect(h.pm2.disconnect).toHaveBeenCalledTimes(2);
    expect(runtime).toEqual({ runtimeId: 'api-2', port: 4000, healthPath: '/health' });
  });

  it('splits a multi-token start command into script + args', async () => {
    const ctx = makeCtx({ buildConfig: { installCmd: undefined, buildCmd: undefined, startCmd: 'npm run start:prod' } });

    await pm2Builder.buildAndRun(ctx as never);

    expect(h.pm2.start).toHaveBeenCalledWith(
      expect.objectContaining({ script: 'npm', args: 'run start:prod', interpreter: 'none' }),
      expect.any(Function),
    );
  });

  it('defaults to npm start when no start command is configured', async () => {
    const ctx = makeCtx({ buildConfig: undefined });

    const runtime = await pm2Builder.buildAndRun(ctx as never);

    expect(h.run).not.toHaveBeenCalled();
    expect(h.pm2.delete).not.toHaveBeenCalled();
    expect(h.pm2.start).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'api-2', script: 'npm', args: 'start', interpreter: 'none' }),
      expect.any(Function),
    );
    expect(runtime).toEqual({ runtimeId: 'api-2', port: 4000, healthPath: '/health' });
  });

  it('sets max_memory_restart when the service has a memory limit', async () => {
    const ctx = makeCtx({
      service: { slug: 'api', port: 4000, healthPath: '/health', memLimitMb: 512 },
      buildConfig: undefined,
    });

    await pm2Builder.buildAndRun(ctx as never);

    expect(h.pm2.start).toHaveBeenCalledWith(
      expect.objectContaining({ max_memory_restart: '512M' }),
      expect.any(Function),
    );
  });

  it('omits max_memory_restart when no memory limit is set', async () => {
    const ctx = makeCtx({ buildConfig: undefined });

    await pm2Builder.buildAndRun(ctx as never);

    const opts = h.pm2.start.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts['max_memory_restart']).toBeUndefined();
  });

  it('defaults null port and healthPath in the returned runtime', async () => {
    const ctx = makeCtx({
      service: { slug: 'api', port: null, healthPath: null, memLimitMb: 0 },
      buildConfig: undefined,
    });

    const runtime = await pm2Builder.buildAndRun(ctx as never);

    expect(runtime).toEqual({ runtimeId: 'api-2', port: null, healthPath: '/' });
  });

  it('rejects when pm2.start fails but still disconnects', async () => {
    h.pm2.start.mockImplementationOnce((_opts: unknown, cb: (err?: Error | null) => void) =>
      cb(new Error('start failed')),
    );
    const ctx = makeCtx({ buildConfig: undefined });

    await expect(pm2Builder.buildAndRun(ctx as never)).rejects.toThrow('start failed');
    expect(h.pm2.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects without disconnecting when pm2.connect fails', async () => {
    h.pm2.connect.mockImplementationOnce((cb: (err?: Error | null) => void) => cb(new Error('daemon down')));
    const ctx = makeCtx({ buildConfig: undefined });

    await expect(pm2Builder.buildAndRun(ctx as never)).rejects.toThrow('daemon down');
    expect(h.pm2.disconnect).not.toHaveBeenCalled();
  });
});

describe('pm2Builder.isHealthy', () => {
  it('returns true when a described process is online', async () => {
    h.pm2.describe.mockImplementationOnce((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) =>
      cb(null, [{ pm2_env: { status: 'online' } }]),
    );

    await expect(pm2Builder.isHealthy({ runtimeId: 'api-2', port: null, healthPath: '/' }, 1000)).resolves.toBe(true);
  });

  it('returns false when no process becomes online before the deadline', async () => {
    h.pm2.describe.mockImplementation((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) =>
      cb(null, [{ pm2_env: { status: 'stopped' } }]),
    );

    await expect(pm2Builder.isHealthy({ runtimeId: 'api-2', port: null, healthPath: '/' }, 30)).resolves.toBe(false);
    expect(h.sleep).toHaveBeenCalledWith(1000);
  });

  it('handles null entries in the description list', async () => {
    h.pm2.describe.mockImplementation((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) =>
      cb(null, [null]),
    );

    await expect(pm2Builder.isHealthy({ runtimeId: 'api-2', port: null, healthPath: '/' }, 30)).resolves.toBe(false);
  });

  it('falls back to an empty description list when describe returns null', async () => {
    h.pm2.describe.mockImplementation((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) =>
      cb(null, null),
    );

    await expect(pm2Builder.isHealthy({ runtimeId: 'api-2', port: null, healthPath: '/' }, 30)).resolves.toBe(false);
  });

  it('returns false when describe errors', async () => {
    h.pm2.describe.mockImplementation((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) =>
      cb(new Error('not found')),
    );

    await expect(pm2Builder.isHealthy({ runtimeId: 'api-2', port: null, healthPath: '/' }, 30)).resolves.toBe(false);
  });
});

describe('pm2Builder.stop', () => {
  it('deletes the process', async () => {
    await expect(pm2Builder.stop('api-2')).resolves.toBeUndefined();

    expect(h.pm2.delete).toHaveBeenCalledWith('api-2', expect.any(Function));
    expect(h.pm2.connect).toHaveBeenCalledTimes(1);
    expect(h.pm2.disconnect).toHaveBeenCalledTimes(1);
  });

  it('swallows errors, including a failing connect', async () => {
    h.pm2.connect.mockImplementationOnce((cb: (err?: Error | null) => void) => cb(new Error('daemon down')));

    await expect(pm2Builder.stop('api-2')).resolves.toBeUndefined();
  });
});
