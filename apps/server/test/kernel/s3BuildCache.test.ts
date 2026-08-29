import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3BuildCache } from '../../src/kernel/drivers/s3BuildCache.js';

interface FakeFetch {
  calls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }>;
  /** When set, the next response carries this digest. */
  nextDigest: string | null;
  /** When true, the next response is 404. */
  nextMissing: boolean;
}

function makeFakeFetch(): FakeFetch {
  return { calls: [], nextDigest: null, nextMissing: false };
}

function installFetch(fetchMock: FakeFetch): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    fetchMock.calls.push({ url: urlStr, init });
    if (fetchMock.nextMissing) {
      fetchMock.nextMissing = false;
      return { status: 404, headers: new Headers() } as never;
    }
    if (init.method === 'HEAD') {
      const headers = new Headers();
      if (fetchMock.nextDigest) {
        headers.set('x-amz-meta-ninedeploy-digest', fetchMock.nextDigest);
        headers.set('x-amz-meta-ninedeploy-size', '4096');
        headers.set('last-modified', 'Sat, 29 Aug 2026 10:00:00 GMT');
        fetchMock.nextDigest = null;
      }
      return { status: 200, headers } as never;
    }
    if (init.method === 'PUT') {
      return { status: 200 } as never;
    }
    return { status: 405, headers: new Headers() } as never;
  });
}

function newCache(): { cache: S3BuildCache; fetchMock: FakeFetch } {
  const fetchMock = makeFakeFetch();
  // Patch s3Request to use the fake fetch. s3Request calls fetch
  // directly, so we monkey-patch the test's globalThis.fetch for the
  // duration of the test.
  const origFetch = globalThis.fetch;
  globalThis.fetch = installFetch(fetchMock) as never;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });
  const cache = new S3BuildCache({
    config: {
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    },
    prefix: 'build-cache/',
  });
  return { cache, fetchMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('S3BuildCache', () => {
  it('exposes a stable name and starts at zero stats', async () => {
    const { cache } = newCache();
    expect(cache.name).toBe('s3');
    const stats = await cache.stats();
    expect(stats).toEqual({ entries: 0, totalBytes: 0, hits: 0, misses: 0, stores: 0, evictions: 0 });
  });

  it('records a miss when the object is absent', async () => {
    const { cache, fetchMock } = newCache();
    fetchMock.nextMissing = true;
    const ref = await cache.lookup('ndbuild:abc');
    expect(ref).toBeNull();
    const stats = await cache.stats();
    expect(stats.misses).toBe(1);
  });

  it('returns the digest from the metadata header on a hit', async () => {
    const { cache, fetchMock } = newCache();
    fetchMock.nextDigest = 'sha256:abc';
    const ref = await cache.lookup('ndbuild:abc');
    expect(ref?.digest).toBe('sha256:abc');
    expect(ref?.sizeBytes).toBe(4096);
    const stats = await cache.stats();
    expect(stats.hits).toBe(1);
  });

  it('records a miss when the metadata header is missing (wrong prefix)', async () => {
    const { cache } = newCache();
    // No nextDigest set → HEAD returns 200 but headers are empty.
    const ref = await cache.lookup('ndbuild:abc');
    expect(ref).toBeNull();
  });

  it('uses the configured prefix to scope object keys', async () => {
    const { cache, fetchMock } = newCache();
    fetchMock.nextDigest = 'sha256:abc';
    await cache.lookup('ndbuild:abc');
    expect(fetchMock.calls.length).toBe(1);
    expect(fetchMock.calls[0]?.init.method).toBe('HEAD');
    expect(fetchMock.calls[0]?.url).toContain('/test-bucket/build-cache/');
  });

  it('isolates two operators on the same bucket via the prefix', async () => {
    const fetchMock = makeFakeFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = installFetch(fetchMock) as never;
    afterEach(() => {
      globalThis.fetch = origFetch;
    });
    const a = new S3BuildCache({ config: baseCfg(), prefix: 'team-a/' });
    const b = new S3BuildCache({ config: baseCfg(), prefix: 'team-b/' });
    fetchMock.nextDigest = 'sha256:abc';
    await a.lookup('ndbuild:shared');
    fetchMock.nextDigest = 'sha256:abc';
    await b.lookup('ndbuild:shared');
    const headUrls = fetchMock.calls.filter((c) => c.init.method === 'HEAD').map((c) => c.url);
    expect(headUrls.some((u) => u.includes('/team-a/'))).toBe(true);
    expect(headUrls.some((u) => u.includes('/team-b/'))).toBe(true);
  });

  it('parses a marker blob on store() and surfaces the digest', async () => {
    const { cache } = newCache();
    const ref = await cache.store('ndbuild:abc', Buffer.from(JSON.stringify({ digest: 'sha256:def', sizeBytes: 4096, ts: 0 })));
    expect(ref.digest).toBe('sha256:def');
    expect(ref.sizeBytes).toBe(4096);
    const stats = await cache.stats();
    expect(stats.stores).toBe(1);
  });

  it('falls back to a placeholder digest for non-marker blobs', async () => {
    const { cache } = newCache();
    const stored = await cache.store('ndbuild:abc', Buffer.from('not a marker'));
    // Default placeholder = content hash of the blob.
    expect(stored.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('aggregates in-process counters in stats()', async () => {
    const { cache, fetchMock } = newCache();
    fetchMock.nextMissing = true;
    await cache.lookup('a'); // miss
    fetchMock.nextDigest = 'sha256:x';
    await cache.lookup('b'); // hit
    fetchMock.nextDigest = 'sha256:y';
    await cache.lookup('c'); // hit
    await cache.store('d', Buffer.from(JSON.stringify({ digest: 'sha256:z', sizeBytes: 1, ts: 0 }))); // store
    const stats = await cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.stores).toBe(1);
  });
});

function baseCfg() {
  return {
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'AKIA',
    secretAccessKey: 'secret',
  };
}
