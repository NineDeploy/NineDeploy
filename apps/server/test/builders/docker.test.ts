import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dockerBuilder } from '../../src/engine/builders/docker.js';

const h = vi.hoisted(() => {
  const run = vi.fn(async (_cmd: string, _args: unknown[], _opts: unknown, sink?: (line: string) => void) => {
    sink?.('');
  });
  const sleep = vi.fn(async () => undefined);
  const capture = vi.fn(async () => 'running');
  const config: { paths: { dataDir: string } } = { paths: { dataDir: '/tmp/nd-docker-test' } };
  return { run, sleep, capture, config };
});

vi.mock('../../src/lib/exec.js', () => ({ run: h.run, sleep: h.sleep, capture: h.capture }));
vi.mock('../../src/config.js', () => ({ config: h.config }));

const makeCtx = (over: Record<string, unknown> = {}) => ({
  deploymentId: 3,
  service: {
    slug: 'web',
    image: null,
    port: 3000,
    cpuShares: 512,
    memLimitMb: 256,
    volumeMount: '/data',
    healthPath: '/health',
  },
  buildConfig: { baseDir: '/', dockerfilePath: 'Dockerfile' },
  workDir: '/work/web',
  commitSha: 'abcdef12345',
  env: { NODE_ENV: 'production' },
  log: vi.fn(),
  ...over,
});

/** Find the `--env-file <path>` value within a docker argv, if present. */
function envFilePath(args: unknown[]): string | undefined {
  const i = args.indexOf('--env-file');
  return i >= 0 ? (args[i + 1] as string) : undefined;
}

describe('dockerBuilder.buildAndRun', () => {
  beforeEach(() => {
    h.run.mockReset();
    h.run.mockResolvedValue(undefined);
    h.capture.mockReset();
    h.capture.mockResolvedValue('running');
  });

  it('pulls a pre-built image and starts a container with resource/env-file flags', async () => {
    h.run.mockRejectedValueOnce(new Error('pull failed')).mockResolvedValueOnce(undefined);
    const ctx = makeCtx({ service: { slug: 'web', image: 'nginx:1.25', port: 3000, cpuShares: 512, memLimitMb: 256, volumeMount: '/data', healthPath: '/health' } });

    const runtime = await dockerBuilder.buildAndRun(ctx as never);

    const log = ctx.log;
    expect(h.run).toHaveBeenCalledWith('docker', ['pull', 'nginx:1.25'], {}, log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pull warning: pull failed'));
    const runArgs = h.run.mock.calls.at(-1)![1] as unknown[];
    expect(runArgs).toEqual(
      [
        'run', '-d', '--name', 'web-3', '--restart', 'unless-stopped', '--network', 'ninedeploy',
        '-p', '127.0.0.1:3000:3000',
        '--cpu-shares', '512', '--memory', '256m',
        '-v', 'nd-svc-web-data:/data',
        '--env-file', expect.any(String),
        'nginx:1.25',
      ],
    );
    expect(runtime).toEqual({ runtimeId: 'web-3', port: 3000, healthPath: '/health', imageDigest: expect.any(String) });
  });

  it('logs a pull warning when the rejection is not an Error instance', async () => {
    h.run.mockRejectedValueOnce('network down').mockResolvedValueOnce(undefined);
    const ctx = makeCtx({ service: { slug: 'web', image: 'nginx:1.25', port: 3000, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: '/health' } });

    await dockerBuilder.buildAndRun(ctx as never);

    expect(ctx.log).toHaveBeenCalledWith('pull warning: network down');
  });

  it('writes env vars to a temp env-file (0600) and deletes it after start', async () => {
    const ctx = makeCtx({ env: { DATABASE_URL: 'postgres://secret@host/db', NODE_ENV: 'production' } });
    await dockerBuilder.buildAndRun(ctx as never);

    const runArgs = h.run.mock.calls.at(-1)![1] as unknown[];
    const file = envFilePath(runArgs);
    expect(file).toBeTruthy();
    expect(existsSync(file)).toBe(false); // unlinked in the finally block
    // The env-file path is the only secret-bearing arg — never the values inline.
    expect(String(runArgs)).not.toContain('secret@host');
  });

  it('passes secrets via env-file, never as -e argv', async () => {
    const ctx = makeCtx({ env: { API_KEY: 'sk-super-secret' } });
    await dockerBuilder.buildAndRun(ctx as never);

    const runArgs = h.run.mock.calls.at(-1)![1] as unknown[];
    expect(runArgs).not.toContain('-e');
    expect(String(runArgs)).not.toContain('sk-super-secret');
  });

  it('builds from source with default baseDir and dockerfile when buildConfig is absent', async () => {
    const ctx = makeCtx({ buildConfig: undefined });

    await dockerBuilder.buildAndRun(ctx as never);

    expect(h.run).toHaveBeenCalledWith(
      'docker',
      ['build', '-t', 'ninedeploy/web:abcdef1', '-f', 'Dockerfile', '.'],
      { cwd: '/work/web', env: { DOCKER_BUILDKIT: '1' } },
      ctx.log,
    );
  });

  it('uses the custom baseDir/dockerfile and falls back to latest tag for an empty sha', async () => {
    const ctx = makeCtx({ commitSha: '', buildConfig: { baseDir: '/app', dockerfilePath: 'Dockerfile.prod' } });

    await dockerBuilder.buildAndRun(ctx as never);

    expect(h.run).toHaveBeenCalledWith(
      'docker',
      ['build', '-t', 'ninedeploy/web:latest', '-f', 'Dockerfile.prod', '/app'],
      { cwd: '/work/web', env: { DOCKER_BUILDKIT: '1' } },
      ctx.log,
    );
  });

  it('omits port/cpu/memory/volume/env flags when unset', async () => {
    const ctx = makeCtx({
      service: { slug: 'x', image: null, port: null, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: '/' },
      env: {},
      commitSha: 'abc',
    });

    await dockerBuilder.buildAndRun(ctx as never);

    const runArgs = h.run.mock.calls.at(-1)![1] as unknown[];
    expect(runArgs).toEqual([
      'run', '-d', '--name', 'x-3', '--restart', 'unless-stopped', '--network', 'ninedeploy', 'ninedeploy/x:abc',
    ]);
  });

  it('defaults the returned healthPath to / when the service has none', async () => {
    const ctx = makeCtx({
      service: { slug: 'y', image: 'busybox', port: null, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: null },
      env: {},
    });

    const runtime = await dockerBuilder.buildAndRun(ctx as never);

    expect(runtime).toEqual({ runtimeId: 'y-3', port: null, healthPath: '/', imageDigest: expect.any(String) });
  });

  it('does NOT stop the previous container (blue-green: old keeps serving until healthy)', async () => {
    const ctx = makeCtx();

    await dockerBuilder.buildAndRun(ctx as never, { runtimeId: 'old-1', port: null, healthPath: '/' });

    // Only build + run are invoked — never `docker stop`/`rm` against the old container.
    const stops = h.run.mock.calls.filter((c) => (c[1] as unknown[])[1] === 'stop' || (c[1] as unknown[])[1] === 'rm');
    expect(stops).toHaveLength(0);
  });

  it('deletes the env-file even when docker run fails', async () => {
    h.run.mockRejectedValueOnce(new Error('pull failed')).mockRejectedValueOnce(new Error('name conflict'));
    const ctx = makeCtx({ service: { slug: 'web', image: 'nginx:1.25', port: 3000, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: '/health' } });

    await expect(dockerBuilder.buildAndRun(ctx as never)).rejects.toThrow('name conflict');

    const runArgs = h.run.mock.calls.at(-1)![1] as unknown[];
    const file = envFilePath(runArgs);
    expect(file).toBeTruthy();
    expect(existsSync(file)).toBe(false);
  });

  it('tolerates a failing digest inspect (imageDigest left undefined)', async () => {
    h.capture.mockRejectedValue(new Error('inspect failed'));
    const ctx = makeCtx({ service: { slug: 'web', image: 'nginx:1.25', port: 3000, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: '/health' } });

    const runtime = await dockerBuilder.buildAndRun(ctx as never);

    expect(runtime.imageDigest).toBeUndefined();
  });

  it('leaves imageDigest undefined when inspect returns an empty value', async () => {
    h.capture.mockResolvedValue('   ');
    const ctx = makeCtx({ service: { slug: 'web', image: 'nginx:1.25', port: 3000, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: '/health' } });

    const runtime = await dockerBuilder.buildAndRun(ctx as never);

    expect(runtime.imageDigest).toBeUndefined();
  });

  it('uses the imageDigest override (rollback pin) instead of the mutable tag', async () => {
    h.capture.mockResolvedValue('sha256:pinned');
    const ctx = makeCtx({
      service: { slug: 'web', image: 'nginx:1.25', port: 3000, cpuShares: 0, memLimitMb: 0, volumeMount: null, healthPath: '/health' },
      imageDigest: 'nginx:1.25@sha256:abc123',
    });

    await dockerBuilder.buildAndRun(ctx as never);

    // The run target is the pinned digest, not the tag.
    const runArgs = h.run.mock.calls.at(-1)![1] as unknown[];
    expect(runArgs[runArgs.length - 1]).toBe('nginx:1.25@sha256:abc123');
  });
});

describe('dockerBuilder.isHealthy', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    h.capture.mockReset();
    h.capture.mockResolvedValue('running');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when there is no port but the container is running', async () => {
    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'r', port: null, healthPath: '/' }, 1000),
    ).resolves.toBe(true);
    expect(h.capture).toHaveBeenCalledWith('docker', ['inspect', 'r', '--format', '{{.State.Status}}']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when the container is not running (regardless of port)', async () => {
    h.capture.mockResolvedValue('exited');
    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'r', port: 3000, healthPath: '/' }, 20),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when the container cannot be inspected (already removed)', async () => {
    h.capture.mockRejectedValue(new Error('No such container'));
    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'gone', port: null, healthPath: '/' }, 20),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns true when the healthcheck responds below 500', async () => {
    fetchMock.mockResolvedValue({ status: 200 });

    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'r', port: 3000, healthPath: '/health' }, 1000),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('uses "/" as the default health path', async () => {
    fetchMock.mockResolvedValue({ status: 200 });

    await dockerBuilder.isHealthy({ runtimeId: 'r', port: 3000, healthPath: '' }, 1000);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3000/', expect.any(Object));
  });

  it('returns false when the service never becomes healthy', async () => {
    fetchMock.mockResolvedValue({ status: 503 });

    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'r', port: 3000, healthPath: '/' }, 20),
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    expect(h.sleep).toHaveBeenCalledWith(1000);
  });

  it('returns false when the fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'r', port: 3000, healthPath: '/' }, 20),
    ).resolves.toBe(false);
  });

  it('treats a container that vanishes mid-probe as unhealthy', async () => {
    // First inspect says running (so we proceed to fetch), then it disappears.
    h.capture.mockResolvedValueOnce('running').mockResolvedValueOnce('');
    fetchMock.mockRejectedValue(new Error('refused'));

    await expect(
      dockerBuilder.isHealthy({ runtimeId: 'r', port: 3000, healthPath: '/' }, 20),
    ).resolves.toBe(false);
  });
});

describe('dockerBuilder.stop', () => {
  beforeEach(() => {
    h.run.mockReset();
    // Mirror the real exec.run default: it invokes the sink (here `swallow`).
    h.run.mockImplementation(async (_c, _a, _o, sink) => {
      sink?.('');
    });
  });

  it('stops and removes the container', async () => {
    await dockerBuilder.stop('web-3');

    expect(h.run).toHaveBeenCalledWith('docker', ['stop', '-t', '5', 'web-3'], {}, expect.any(Function));
    expect(h.run).toHaveBeenCalledWith('docker', ['rm', '-f', 'web-3'], {}, expect.any(Function));
  });

  it('swallows errors from both commands', async () => {
    h.run.mockRejectedValueOnce(new Error('gone')).mockRejectedValueOnce(new Error('gone'));

    await expect(dockerBuilder.stop('web-3')).resolves.toBeUndefined();
  });
});
