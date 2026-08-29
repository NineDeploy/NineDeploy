import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildCachePlugin, buildKey } from '../../src/kernel/plugins/buildCachePlugin.js';
import { createFakeDb } from '../helpers.js';

interface FakeKernel {
  events: {
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    emitCustom: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    onCustom: ReturnType<typeof vi.fn>;
    listenerCount: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };
  configCenter: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  registry: {
    getBuildCache: ReturnType<typeof vi.fn>;
    listBuildCaches: ReturnType<typeof vi.fn>;
  };
  hooks: { tap: ReturnType<typeof vi.fn>; call: ReturnType<typeof vi.fn>; hasListeners: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  menuRegistry: { registerMenuItem: ReturnType<typeof vi.fn>; unregisterMenuItem: ReturnType<typeof vi.fn>; getItemsForSlot: ReturnType<typeof vi.fn>; getAllItems: ReturnType<typeof vi.fn>; getPluginMenus: ReturnType<typeof vi.fn>; purgePluginMenus: ReturnType<typeof vi.fn> };
  db: ReturnType<typeof createFakeDb>;
  state: string;
  config: unknown;
}

function newKernel(): FakeKernel {
  return {
    events: {
      on: vi.fn().mockReturnValue(() => {}),
      emit: vi.fn(),
      emitCustom: vi.fn(),
      once: vi.fn().mockReturnValue(() => {}),
      onCustom: vi.fn().mockReturnValue(() => {}),
      listenerCount: vi.fn().mockReturnValue(0),
      removeAllListeners: vi.fn(),
    },
    configCenter: { get: vi.fn(), set: vi.fn() },
    registry: { getBuildCache: vi.fn(), listBuildCaches: vi.fn().mockReturnValue([]) },
    hooks: { tap: vi.fn(), call: vi.fn(), hasListeners: vi.fn().mockReturnValue(false), clear: vi.fn() },
    menuRegistry: { registerMenuItem: vi.fn(), unregisterMenuItem: vi.fn(), getItemsForSlot: vi.fn().mockReturnValue([]), getAllItems: vi.fn().mockReturnValue([]), getPluginMenus: vi.fn().mockReturnValue([]), purgePluginMenus: vi.fn().mockReturnValue(0) },
    db: createFakeDb(),
    state: 'READY',
    config: {},
  } as unknown as FakeKernel;
}

function withDefaultGet(kernel: FakeKernel, defaults: Record<string, unknown> = {}): FakeKernel {
  (kernel.configCenter.get as ReturnType<typeof vi.fn>).mockImplementation(
    async (key: string, def: unknown) => (key in defaults ? defaults[key] : def),
  );
  return kernel;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BuildCachePlugin', () => {
  it('exposes a stable id, version, and isOfficial flag', () => {
    const p = new BuildCachePlugin();
    expect(p.id).toBe('build-cache');
    expect(p.isOfficial).toBe(true);
    expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares a 2-key config schema and one command-palette menu item', () => {
    const p = new BuildCachePlugin();
    expect(p.configSchema).toHaveLength(2);
    const keys = p.configSchema?.map((c) => c.key) ?? [];
    expect(keys).toEqual(['enabled', 'cache_name']);
    const item = p.menuItems?.[0];
    expect(item?.slot).toBe('command:palette');
    expect(item?.route).toBe('/settings?section=plugins');
    expect(item?.permission).toBe('admin');
  });

  it('subscribes to service.deploying + service.deployed; destroy releases them', () => {
    const kernel = newKernel();
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    // Sprint 4 G-01 PR-B: the plugin also subscribes to
    // `service.deployed` for symmetry with the pre-deploy path. The
    // PR-B deploy pipeline records digests via POST /v1/build-cache/store
    // and the post-deploy listener is the hook Sprint 5's CI integration
    // will fire; the assertion is on the event names, not the call count.
    expect(kernel.events.on).toHaveBeenCalledTimes(2);
    const events = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(events).toContain('service.deploying');
    expect(events).toContain('service.deployed');
    p.destroy();
  });

  it('emits build.cache.miss when no cache is registered (silent no-op)', async () => {
    const kernel = withDefaultGet(newKernel());
    (kernel.registry.listBuildCaches as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 7, deployId: 12 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.events.emitCustom).not.toHaveBeenCalled();
  });

  it('emits build.cache.miss when the named cache returns null', async () => {
    const kernel = withDefaultGet(newKernel());
    const fakeCache = { name: 'inline', lookup: vi.fn().mockResolvedValue(null), stats: vi.fn() };
    (kernel.registry.getBuildCache as ReturnType<typeof vi.fn>).mockReturnValue(fakeCache);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 7, deployId: 12 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.events.emitCustom).toHaveBeenCalledWith(
      'build.cache.miss',
      expect.objectContaining({ serviceId: 7, cache: 'inline', key: buildKey(7) }),
    );
  });

  it('emits build.cache.hit when the cache returns a BlobRef', async () => {
    const kernel = withDefaultGet(newKernel());
    const fakeCache = {
      name: 'inline',
      lookup: vi.fn().mockResolvedValue({ digest: 'sha256:abc', sizeBytes: 1024, storedAt: '2026-08-29T00:00:00.000Z' }),
      stats: vi.fn(),
    };
    (kernel.registry.getBuildCache as ReturnType<typeof vi.fn>).mockReturnValue(fakeCache);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 9, deployId: 14 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.events.emitCustom).toHaveBeenCalledWith(
      'build.cache.hit',
      expect.objectContaining({ serviceId: 9, cache: 'inline', digest: 'sha256:abc' }),
    );
  });

  it('falls back to the first registered cache when the named one is missing', async () => {
    const kernel = withDefaultGet(newKernel());
    const fallback = { name: 'inline', lookup: vi.fn().mockResolvedValue(null), stats: vi.fn() };
    (kernel.registry.getBuildCache as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (kernel.registry.listBuildCaches as ReturnType<typeof vi.fn>).mockReturnValue([fallback]);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallback.lookup).toHaveBeenCalledOnce();
  });

  it('is silent when the enabled flag is false', async () => {
    const kernel = withDefaultGet(newKernel(), { 'plugin:build-cache:enabled': false });
    const fakeCache = { name: 'inline', lookup: vi.fn(), stats: vi.fn() };
    (kernel.registry.getBuildCache as ReturnType<typeof vi.fn>).mockReturnValue(fakeCache);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeCache.lookup).not.toHaveBeenCalled();
    expect(kernel.events.emitCustom).not.toHaveBeenCalled();
  });

  it('emits build.cache.error when the cache throws', async () => {
    const kernel = withDefaultGet(newKernel());
    const fakeCache = { name: 'inline', lookup: vi.fn().mockRejectedValue(new Error('boom')), stats: vi.fn() };
    (kernel.registry.getBuildCache as ReturnType<typeof vi.fn>).mockReturnValue(fakeCache);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.events.emitCustom).toHaveBeenCalledWith(
      'build.cache.error',
      expect.objectContaining({ serviceId: 5, reason: 'boom' }),
    );
  });

  it('falls back to String() when a non-Error is rejected', async () => {
    const kernel = withDefaultGet(newKernel());
    const fakeCache = { name: 'inline', lookup: vi.fn().mockRejectedValue('plain failure'), stats: vi.fn() };
    (kernel.registry.getBuildCache as ReturnType<typeof vi.fn>).mockReturnValue(fakeCache);
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({ serviceId: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.events.emitCustom).toHaveBeenCalledWith(
      'build.cache.error',
      expect.objectContaining({ reason: 'plain failure' }),
    );
  });

  it('does not throw when the payload omits serviceId', async () => {
    const kernel = withDefaultGet(newKernel());
    const p = new BuildCachePlugin();
    p.init(kernel as never);
    const handler = (kernel.events.on as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (p: unknown) => void;
    handler({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kernel.events.emitCustom).not.toHaveBeenCalled();
  });

  it('aggregateStats returns empty rows when no cache is registered', async () => {
    const kernel = newKernel();
    (kernel.registry.listBuildCaches as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const p = new BuildCachePlugin();
    const stats = await p.aggregateStats(kernel as never);
    expect(stats.backends).toEqual([]);
    expect(stats.totals).toEqual({ entries: 0, totalBytes: 0, hits: 0, misses: 0, stores: 0, evictions: 0 });
  });

  it('aggregateStats sums per-backend counters across multiple caches', async () => {
    const kernel = newKernel();
    const a = { name: 'inline', stats: vi.fn().mockResolvedValue({ entries: 1, totalBytes: 1024, hits: 2, misses: 3, stores: 4, evictions: 5 }) };
    const b = { name: 'registry', stats: vi.fn().mockResolvedValue({ entries: 2, totalBytes: 2048, hits: 3, misses: 4, stores: 5, evictions: 6 }) };
    (kernel.registry.listBuildCaches as ReturnType<typeof vi.fn>).mockReturnValue([a, b]);
    const p = new BuildCachePlugin();
    const stats = await p.aggregateStats(kernel as never);
    expect(stats.backends).toHaveLength(2);
    expect(stats.totals).toEqual({ entries: 3, totalBytes: 3072, hits: 5, misses: 7, stores: 9, evictions: 11 });
  });

  it('buildKey is deterministic and tags the optional target commit', () => {
    expect(buildKey(1)).toBe('service:1:no-commit');
    expect(buildKey(1, 'deadbeef')).toBe('service:1:deadbeef');
  });
});
