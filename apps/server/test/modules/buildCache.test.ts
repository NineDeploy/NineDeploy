import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildCachePlugin } from '../../src/kernel/plugins/buildCachePlugin.js';
import { buildCacheRoutes } from '../../src/modules/buildCache.js';
import { asUser, buildTestApp } from '../helpers.js';

async function newApp() {
  const a = await buildTestApp();
  const plugin = new BuildCachePlugin();
  await a.kernel.registerPlugin(plugin);
  await a.register(buildCacheRoutes);
  return { app: a, plugin };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /v1/build-cache/stats', () => {
  it('returns the merged aggregate stats from the running plugin', async () => {
    const { app, plugin } = await newApp();
    vi.spyOn(plugin, 'aggregateStats').mockResolvedValue({
      backends: [{ name: 'inline', entries: 1, totalBytes: 1024, hits: 4, misses: 6, stores: 5, evictions: 1 }],
      totals: { entries: 1, totalBytes: 1024, hits: 4, misses: 6, stores: 5, evictions: 1 },
    });
    const res = await app.inject({ method: 'GET', url: '/stats', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      backends: [{ name: 'inline', entries: 1, totalBytes: 1024, hits: 4, misses: 6, stores: 5, evictions: 1 }],
      totals: { entries: 1, totalBytes: 1024, hits: 4, misses: 6, stores: 5, evictions: 1 },
    });
    expect(plugin.aggregateStats).toHaveBeenCalledOnce();
  });

  it('returns zeroed totals when the plugin is not registered (defensive default)', async () => {
    const a = await buildTestApp();
    await a.register(buildCacheRoutes);
    const res = await a.inject({ method: 'GET', url: '/stats', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      backends: [],
      totals: { entries: 0, totalBytes: 0, hits: 0, misses: 0, stores: 0, evictions: 0 },
    });
  });

  it('rejects unauthenticated callers', async () => {
    const { app } = await newApp();
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/build-cache/store', () => {
  it('stores a digest in the active cache and returns the BlobRef', async () => {
    const { app, plugin } = await newApp();
    // The test app's kernel has no build cache registered by default.
    // Register a fake inline driver so the route has something to call.
    const fakeCache = { name: 'inline', store: vi.fn().mockResolvedValue({
      digest: 'sha256:abc', sizeBytes: 8, storedAt: '2026-08-29T00:00:00.000Z',
    }) };
    app.kernel.registry.registerBuildCache(fakeCache as never);
    void plugin;

    const res = await app.inject({
      method: 'POST',
      url: '/store',
      headers: asUser(),
      payload: { key: 'ndbuild:abc', digest: 'sha256:def', sizeBytes: 4096 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; backend: string; ref: { digest: string; sizeBytes: number } };
    expect(body.ok).toBe(true);
    expect(body.backend).toBe('inline');
    expect(body.ref.sizeBytes).toBe(4096);
    expect(fakeCache.store).toHaveBeenCalledOnce();
  });

  it('rejects when key is missing', async () => {
    const { app } = await newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/store',
      headers: asUser(),
      payload: { digest: 'sha256:def' },
    });
    expect(res.statusCode).toBe(200); // helper returns 200 with ok:false
    const body = res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/key/);
  });

  it('rejects a non-sha256 digest', async () => {
    const { app } = await newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/store',
      headers: asUser(),
      payload: { key: 'ndbuild:abc', digest: 'md5:deadbeef' },
    });
    const body = res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/sha256/);
  });

  it('rejects unauthenticated callers', async () => {
    const { app } = await newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/store',
      payload: { key: 'k', digest: 'sha256:abc' },
    });
    expect(res.statusCode).toBe(401);
  });
});
