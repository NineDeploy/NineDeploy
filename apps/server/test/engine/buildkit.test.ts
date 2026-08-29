import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWithBuildKit } from '../../src/engine/builders/buildkit.js';

interface FakeCache {
  name: string;
  lookup: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
}

function newCache(): FakeCache {
  return {
    name: 'inline',
    lookup: vi.fn(),
    store: vi.fn(),
    stats: vi.fn(),
  };
}

const log: (line: string) => void = () => {};

let runMock: ReturnType<typeof vi.fn>;
let captureMock: ReturnType<typeof vi.fn>;
vi.mock('../../src/lib/exec.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
  capture: (...args: unknown[]) => captureMock(...args),
  buildEnv: (extra?: Record<string, string>) => ({ ...(extra ?? {}) }),
}));

beforeEach(() => {
  runMock = vi.fn();
  captureMock = vi.fn();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('buildWithBuildKit', () => {
  it('uses the inline `empty` cache-from when no cache is registered', async () => {
    runMock.mockResolvedValue(undefined);
    const result = await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'myimage:latest',
      serviceId: 1,
      log,
    });
    expect(result.image).toBe('myimage:latest');
    expect(result.cacheKey).toBe('');
    expect(result.cacheHit).toBe(false);
    // The argv must include `--cache-from=type=registry,ref=empty`
    const args = runMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain('--cache-from');
    expect(args[args.indexOf('--cache-from') + 1]).toBe('type=registry,ref=empty');
    expect(args).toContain('--cache-to');
    expect(args[args.indexOf('--cache-to') + 1]).toBe('type=inline');
  });

  it('marks cache hit and uses the digest when lookup returns a ref', async () => {
    runMock.mockResolvedValue(undefined);
    captureMock.mockResolvedValue('myimage@sha256:abc');
    const cache = newCache();
    (cache.lookup as ReturnType<typeof vi.fn>).mockResolvedValue({
      digest: 'sha256:abc',
      sizeBytes: 1024,
      storedAt: '2026-08-29T00:00:00.000Z',
    });
    (cache.store as ReturnType<typeof vi.fn>).mockResolvedValue({
      digest: 'sha256:def',
      sizeBytes: 8,
      storedAt: '2026-08-29T00:00:00.000Z',
    });

    const result = await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'myimage:latest',
      serviceId: 1,
      cache,
      log,
    });

    expect(result.cacheHit).toBe(true);
    expect(result.imageDigest).toBe('myimage@sha256:abc');
    const args = runMock.mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf('--cache-from') + 1]).toBe('type=registry,ref=sha256:abc');
  });

  it('keeps running the build when cache.lookup throws', async () => {
    runMock.mockResolvedValue(undefined);
    const cache = newCache();
    (cache.lookup as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    (cache.store as ReturnType<typeof vi.fn>).mockResolvedValue({
      digest: 'sha256:def',
      sizeBytes: 8,
      storedAt: '2026-08-29T00:00:00.000Z',
    });

    const result = await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'myimage:latest',
      serviceId: 1,
      cache,
      log,
    });
    expect(result.cacheHit).toBe(false);
    expect(result.image).toBe('myimage:latest');
  });

  it('keeps the build successful when cache.store throws after a successful run', async () => {
    runMock.mockResolvedValue(undefined);
    const cache = newCache();
    (cache.lookup as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cache.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'));

    const result = await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'myimage:latest',
      serviceId: 1,
      cache,
      log,
    });
    expect(result.image).toBe('myimage:latest');
  });

  it('produces a stable cache key for identical inputs', async () => {
    runMock.mockResolvedValue(undefined);
    const cache = newCache();
    (cache.lookup as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cache.store as ReturnType<typeof vi.fn>).mockResolvedValue({
      digest: 'sha256:def',
      sizeBytes: 8,
      storedAt: '2026-08-29T00:00:00.000Z',
    });
    await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'a:latest',
      serviceId: 1,
      cache,
      log,
    });
    await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'b:latest',
      serviceId: 1,
      cache,
      log,
    });
    const keys = (cache.lookup as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(keys[0]).toBe(keys[1]);
  });

  it('produces a different cache key when commit changes', async () => {
    runMock.mockResolvedValue(undefined);
    const cache = newCache();
    (cache.lookup as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cache.store as ReturnType<typeof vi.fn>).mockResolvedValue({
      digest: 'sha256:def',
      sizeBytes: 8,
      storedAt: '2026-08-29T00:00:00.000Z',
    });
    await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'a:latest',
      serviceId: 1,
      commitSha: 'aaa',
      cache,
      log,
    });
    await buildWithBuildKit({
      workDir: '/work',
      dockerfilePath: 'Dockerfile',
      baseDir: '.',
      target: 'a:latest',
      serviceId: 1,
      commitSha: 'bbb',
      cache,
      log,
    });
    const keys = (cache.lookup as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('propagates the buildx failure when docker buildx exits non-zero', async () => {
    runMock.mockRejectedValue(new Error('`docker buildx build` exited with code 1'));
    await expect(
      buildWithBuildKit({
        workDir: '/work',
        dockerfilePath: 'Dockerfile',
        baseDir: '.',
        target: 'myimage:latest',
        serviceId: 1,
        log,
      }),
    ).rejects.toThrow(/buildx build/);
  });
});
