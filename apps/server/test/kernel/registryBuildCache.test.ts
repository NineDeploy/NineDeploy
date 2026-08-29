import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { RegistryBuildCache } from '../../src/kernel/drivers/registryBuildCache.js';
import { createFakeDb } from '../helpers.js';

interface FakeFetch {
  calls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }>;
  manifestByTag: Map<string, { digest: string; sizeBytes: number }>;
}

function makeFakeFetch(): FakeFetch {
  return {
    manifestByTag: new Map<string, { digest: string; sizeBytes: number }>(),
    calls: [],
  };
}

function installFetch(fetchMock: FakeFetch): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    fetchMock.calls.push({ url, init });
    const tag = decodeURIComponent(url.split('/manifests/')[1] ?? '');
    if (init.method === 'HEAD') {
      const hit = fetchMock.manifestByTag.get(tag);
      if (!hit) return { status: 404, headers: new Map() } as never;
      const headers = new Map<string, string>([
        ['Docker-Content-Digest', hit.digest],
        ['Content-Length', String(hit.sizeBytes)],
      ]);
      return { status: 200, headers } as never;
    }
    if (init.method === 'PUT') {
      const parsed = JSON.parse(init.body ?? '{}') as { layers?: Array<{ digest: string; size: number }> };
      const layer = parsed.layers?.[0];
      if (!layer) return { status: 400 } as never;
      fetchMock.manifestByTag.set(tag, { digest: layer.digest, sizeBytes: layer.size });
      return { status: 201 } as never;
    }
    return { status: 405 } as never;
  });
}

function newCache(): { cache: RegistryBuildCache; fetchMock: FakeFetch } {
  const fetchMock = makeFakeFetch();
  const db = createFakeDb();
  const cache = new RegistryBuildCache({
    db,
    url: 'https://registry.example.com',
    repo: 'ninedeploy/test',
    fetchImpl: installFetch(fetchMock),
  });
  return { cache, fetchMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function digest(blob: Buffer | Uint8Array): string {
  return `sha256:${createHash('sha256').update(blob).digest('hex')}`;
}

describe('RegistryBuildCache', () => {
  it('exposes a stable name and starts at zero stats', async () => {
    const { cache } = newCache();
    expect(cache.name).toBe('registry');
    const stats = await cache.stats();
    expect(stats).toEqual({ entries: 0, totalBytes: 0, hits: 0, misses: 0, stores: 0, evictions: 0 });
  });

  it('records a miss on lookup when the registry returns 404', async () => {
    const { cache } = newCache();
    const ref = await cache.lookup('ndbuild:abc');
    expect(ref).toBeNull();
    const stats = await cache.stats();
    expect(stats.misses).toBe(1);
  });

  it('passes the configured credentials via the Authorization header on push', async () => {
    const fetchMock = makeFakeFetch();
    const db = createFakeDb();
    const cache = new RegistryBuildCache({
      db,
      url: 'https://registry.example.com',
      repo: 'ninedeploy/test',
      username: 'alice',
      password: 's3cret',
      fetchImpl: installFetch(fetchMock),
    });
    const marker = Buffer.from(JSON.stringify({ digest: 'sha256:auth', sizeBytes: 1, ts: 0 }));
    await cache.store('ndbuild:auth', marker);
    const putCall = fetchMock.calls.find((c) => c.init.method === 'PUT');
    expect(putCall).toBeDefined();
    const authHeader = putCall?.init.headers?.Authorization;
    expect(authHeader).toMatch(/^Basic /);
  });

  it('skips a non-marker blob and uses a placeholder digest', async () => {
    const { cache } = newCache();
    const stored = await cache.store('ndbuild:xyz', Buffer.from('not a marker'));
    expect(stored.digest).toBe(digest(Buffer.from('not a marker')));
  });

  it('puts a manifest on the registry with the expected OCI shape', async () => {
    const { cache, fetchMock } = newCache();
    const marker = Buffer.from(JSON.stringify({ digest: 'sha256:shape', sizeBytes: 42, ts: 0 }));
    await cache.store('ndbuild:shape', marker);
    const putCall = fetchMock.calls.find((c) => c.init.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(putCall?.init.headers?.['Content-Type']).toMatch(/application\/vnd\.oci\.image\.manifest/);
    const body = JSON.parse(putCall?.init.body ?? '{}') as { schemaVersion: number; layers?: Array<{ digest: string }> };
    expect(body.schemaVersion).toBe(2);
    expect(body.layers?.[0]?.digest).toBe('sha256:shape');
  });

  it('maps a key with non-tag-safe characters to a valid OCI tag', async () => {
    const { cache, fetchMock } = newCache();
    const marker = Buffer.from(JSON.stringify({ digest: 'sha256:tag', sizeBytes: 1, ts: 0 }));
    await cache.store('ndbuild:abc/123', marker);
    // The registry path should contain a tag without `/`.
    const putCall = fetchMock.calls.find((c) => c.init.method === 'PUT');
    expect(putCall?.url).toMatch(/\/manifests\//);
    const tag = putCall?.url.split('/manifests/')[1];
    expect(tag).not.toContain('/');
  });
});
