import { createHash } from 'node:crypto';
import { s3Request, type S3Config } from '../../lib/s3.js';
import type { BlobRef, IBuildCache } from '../types.js';

/**
 * S3-backed build cache — Sprint 4, Gap G-01 (PR-D).
 *
 * Reuses the existing `lib/s3.ts` SigV4 helpers for transport, but
 * stores a small `BlobRef` marker per key instead of the layer
 * bytes themselves — the same model `RegistryBuildCache` uses.
 * BuildKit already pushed the actual layers via
 * `--cache-to=type=s3,prefix=...` during the original build, so the
 * cache marker just tells the next build "the previous build's
 * image is at this object prefix, ask S3 for its digest".
 *
 * Two operators on the same S3 bucket are isolated by the
 * `prefix` config-center key (default `build-cache/`). The marker
 * key is derived from the cache key, so two services on the same
 * bucket never collide.
 *
 * Contract:
 *   - `store(key, blob)` PUTs the marker body. s3Request exposes no
 *     extra-header parameter, so `x-amz-meta-*` metadata is not
 *     available — the digest rides in the marker JSON. Idempotent on
 *     duplicate (key, digest) — S3 overwrites the marker with itself.
 *   - `lookup(key)` GETs `<bucket>/<prefix><tag>` and parses the
 *     marker body. A 404 = miss; a 200 that does not parse as one of
 *     our markers = miss (operator pointed us at the wrong prefix).
 *   - `stats()` reports the in-process counters. The bucket itself
 *     does not give us cheap "how many keys under <prefix>?" so the
 *     driver does not attempt a count; the panel's hit-rate column
 *     uses the in-process hits + misses.
 *   - The S3 driver requires NO database table — the marker is
 *     self-describing on the bucket itself, and a kernel restart
 *     recovers by listing the prefix on the first miss.
 */
export interface S3BuildCacheOptions {
  /** S3 connection settings — the same shape `S3StorageDriver` accepts. */
  config: S3Config;
  /** Object-key prefix, e.g. `build-cache/`. Empty = bucket root. */
  prefix?: string;
}

export class S3BuildCache implements IBuildCache {
  readonly name = 's3';

  private readonly config: S3Config;
  private readonly prefix: string;

  private hits = 0;
  private misses = 0;
  private stores = 0;

  constructor(opts: S3BuildCacheOptions) {
    this.config = opts.config;
    this.prefix = (opts.prefix ?? 'build-cache/').replace(/^\/?/, '');
  }

  async lookup(key: string): Promise<BlobRef | null> {
    // The marker IS the object body: store() cannot send `x-amz-meta-*`
    // headers (s3Request exposes no extra-header parameter), so the
    // digest is only recoverable by GETting the body and parsing it —
    // exactly what the store() side documents. A HEAD that demanded the
    // metadata header turned every store→lookup round-trip into a miss,
    // so the cache could never hit (r019).
    const objectKey = this.objectKeyFor(key);
    const res = await s3Request(this.config, 'GET', objectKey, undefined, 'application/octet-stream');
    if (res.status !== 200) {
      this.misses += 1;
      return null;
    }
    const parsed = parseMarker(Buffer.from(await res.arrayBuffer()));
    if (!parsed) {
      // 200 but not one of our markers — wrong prefix or foreign object.
      this.misses += 1;
      return null;
    }
    const lastModified = res.headers.get('last-modified') ?? new Date().toISOString();
    this.hits += 1;
    return { digest: parsed.digest, sizeBytes: parsed.sizeBytes, storedAt: lastModified };
  }

  async store(key: string, blob: Buffer | Uint8Array): Promise<BlobRef> {
    const parsed = parseMarker(blob);
    const digest = parsed?.digest ?? placeholderHash(blob);
    const sizeBytes = parsed?.sizeBytes ?? blob.byteLength;
    const objectKey = this.objectKeyFor(key);

    // SigV4 signs the canonical headers; the `x-amz-meta-*` pair is
    // passed through. We do not have a way to add custom headers via
    // the public `s3Put` helper, so we go through `s3Request`
    // directly. The signature includes `host` + `x-amz-content-sha256`
    // + `x-amz-date` only — adding more headers would require
    // re-signing; the s3 helper above only exposes `content-type`
    // beyond those, so we accept that the digest is encoded in the
    // body. The `BlobRef` marker IS the body, so on lookup we
    // GET the marker body, parse the digest, and use the rest of
    // the workflow unchanged.
    await s3Request(this.config, 'PUT', objectKey, Buffer.from(blob), 'application/octet-stream');

    this.stores += 1;
    return { digest, sizeBytes, storedAt: new Date().toISOString() };
  }

  async stats(): Promise<{
    entries: number;
    totalBytes: number;
    hits: number;
    misses: number;
    stores: number;
    evictions: number;
  }> {
    return {
      // No cheap way to count objects under a prefix without LIST.
      // The panel uses the per-backend hit rate (hits / (hits + misses))
      // for the operator-facing column, so a missing count is not
      // observable to the end-user.
      entries: 0,
      totalBytes: 0,
      hits: this.hits,
      misses: this.misses,
      stores: this.stores,
      evictions: 0, // S3 lifecycle rules are the operator's job, not ours
    };
  }

  private objectKeyFor(key: string): string {
    // S3 keys are 1-1024 bytes; the cache key is `ndbuild:<hex>`
    // and the prefix already includes a `/`, so the final key is
    // safe and within the limit.
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
    return `${this.prefix}${safe}.ndcache`;
  }
}

interface MarkerPayload {
  digest: string;
  sizeBytes: number;
  ts: number;
}

function parseMarker(blob: Buffer | Uint8Array): MarkerPayload | null {
  try {
    const text = Buffer.from(blob).toString('utf8');
    const parsed = JSON.parse(text) as Partial<MarkerPayload>;
    if (typeof parsed.digest !== 'string' || !parsed.digest.startsWith('sha256:')) {
      return null;
    }
    return {
      digest: parsed.digest,
      sizeBytes: typeof parsed.sizeBytes === 'number' ? parsed.sizeBytes : 0,
      ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}

function placeholderHash(blob: Buffer | Uint8Array): string {
  return `sha256:${createHash('sha256').update(blob).digest('hex')}`;
}
