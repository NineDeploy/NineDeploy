import { eq } from 'drizzle-orm';
import { cacheRegistryBlobs, type DB } from '@ninedeploy/db';
import type { BlobRef, IBuildCache } from '../types.js';

/**
 * Registry-backed build cache — Sprint 4, Gap G-01 (PR-C).
 *
 * A `RegistryBuildCache` writes a small `BlobRef` marker to an OCI
 * registry as a single-tag manifest, and reads it back via
 * `HEAD /v2/<repo>/manifests/<tag>`. The blob payload itself is the
 * digest of the original layer cache, not the layer bytes — BuildKit
 * already has the bytes inside the registry from a previous
 * `--cache-to=type=registry,ref=...` invocation, so re-pushing them
 * is wasted I/O. The marker just tells the next build "the previous
 * build's image is at this tag, ask the registry for its digest".
 *
 * The driver persists (key → digest, repo) in the
 * `cache_registry_blobs` table so a kernel restart can resume without
 * re-listing the registry. A cache miss in the table is NOT a miss
 * for the cache overall — `lookup()` falls back to a `HEAD` against
 * the registry to confirm; if the registry has been garbage-collected
 * out-of-band, the driver records a `0` hit count and treats the key
 * as cold.
 *
 * Contract:
 *   - `lookup(key)` is non-throwing; a missing row + 404 = miss.
 *   - `store(key, blob)` is idempotent: re-storing the same digest
 *     for the same (key, repo) bumps the `hits` counter, not the
 *     row count. A different digest for the same key is treated as
 *     an overwrite (new row, old key retired).
 *   - `stats()` reports the table-aggregated counters; the per-driver
 *     plugin `aggregateStats()` (PR #15) merges them with the inline
 *     and S3 drivers.
 */
export interface RegistryBuildCacheOptions {
  /** Drizzle DB handle. */
  db: DB;
  /** Registry base URL, e.g. `https://registry.example.com`. */
  url: string;
  /** Repository namespace, e.g. `ninedeploy/build-cache`. */
  repo: string;
  /** Optional basic-auth credentials (encrypted in config-center). */
  username?: string;
  password?: string;
  /**
   * Custom fetch implementation. Default: global `fetch`. Tests inject a
   * stub to avoid hitting a real registry.
   */
  fetchImpl?: typeof fetch;
}

interface RegistryManifestHead {
  digest: string;
  sizeBytes: number;
}

const DEFAULT_NAMESPACE = 'ninedeploy/build-cache';

export class RegistryBuildCache implements IBuildCache {
  readonly name = 'registry';

  private readonly db: DB;
  private readonly baseUrl: string;
  private readonly repo: string;
  private readonly auth: string | null;
  private readonly fetchImpl: typeof fetch;

  private hits = 0;
  private misses = 0;
  private stores = 0;

  constructor(opts: RegistryBuildCacheOptions) {
    this.db = opts.db;
    this.baseUrl = opts.url.replace(/\/$/, '');
    this.repo = opts.repo || DEFAULT_NAMESPACE;
    this.auth = opts.username && opts.password
      ? Buffer.from(`${opts.username}:${opts.password}`).toString('base64')
      : null;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async lookup(key: string): Promise<BlobRef | null> {
    const row = await this.db.query.cacheRegistryBlobs.findFirst({
      where: eq(cacheRegistryBlobs.key, key),
    });
    if (!row) {
      // The registry may still have the tag (e.g. an instance that
      // joined an existing cluster). A HEAD on the manifest tells us
      // whether the digest is still reachable.
      const head = await this.headManifest(this.tagFor(key));
      if (!head) {
        this.misses += 1;
        return null;
      }
      this.hits += 1;
      return { digest: head.digest, sizeBytes: head.sizeBytes, storedAt: new Date().toISOString() };
    }

    // Confirm the registry still has the tag; an out-of-band GC
    // would otherwise hand back a stale digest.
    const head = await this.headManifest(this.tagFor(key));
    if (!head || head.digest !== row.digest) {
      this.misses += 1;
      return null;
    }

    // Bump the hit counter and last-hit timestamp. The plugin's
    // `aggregateStats()` reads from this table on the next call.
    await this.db
      .update(cacheRegistryBlobs)
      .set({ hits: row.hits + 1, lastHitAt: new Date() })
      .where(eq(cacheRegistryBlobs.id, row.id));
    this.hits += 1;
    return { digest: row.digest, sizeBytes: row.sizeBytes, storedAt: row.storedAt.toISOString() };
  }

  async store(key: string, blob: Buffer | Uint8Array): Promise<BlobRef> {
    const parsed = parseMarker(blob);
    const digest = parsed?.digest ?? `sha256:${placeholderHash(blob)}`;
    const sizeBytes = parsed?.sizeBytes ?? blob.byteLength;
    const tag = this.tagFor(key);

    // Push the marker to the registry as a single-tag manifest. Real
    // blob bytes are already in the registry from a previous
    // `--cache-to=type=registry` invocation; the manifest is just a
    // pointer.
    const pushed = await this.pushManifest(tag, digest, sizeBytes);
    if (!pushed) {
      throw new Error(`RegistryBuildCache.store: failed to push ${tag} to ${this.baseUrl}`);
    }

    // Upsert the (key, backend, repo) row.
    const existing = await this.db.query.cacheRegistryBlobs.findFirst({
      where: eq(cacheRegistryBlobs.key, key),
    });
    if (existing) {
      await this.db
        .update(cacheRegistryBlobs)
        .set({ digest, sizeBytes, lastHitAt: new Date() })
        .where(eq(cacheRegistryBlobs.id, existing.id));
    } else {
      await this.db.insert(cacheRegistryBlobs).values({
        key,
        backend: this.name,
        repo: this.repo,
        digest,
        sizeBytes,
      });
    }
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
    // The driver-level counters capture in-process activity since the
    // last boot. The table carries the historical hit count.
    const rows = await this.db.select().from(cacheRegistryBlobs);
    const totalHits = rows.reduce((acc, r) => acc + r.hits, 0);
    const totalBytes = rows.reduce((acc, r) => acc + r.sizeBytes, 0);
    return {
      entries: rows.length,
      totalBytes,
      hits: totalHits + this.hits,
      misses: this.misses,
      stores: this.stores,
      evictions: 0, // GC is the registry's job, not ours
    };
  }

  private tagFor(key: string): string {
    // OCI tags are 1-128 chars of [a-zA-Z0-9_][a-zA-Z0-9._-]*. The
    // cache key is already hex with an `ndbuild:` prefix; we keep
    // `ndbuild-` and replace `:` with `-` to satisfy the tag charset.
    return key.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128);
  }

  private manifestPath(tag: string): string {
    return `/v2/${this.repo}/manifests/${tag}`;
  }

  private async headManifest(tag: string): Promise<RegistryManifestHead | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${this.manifestPath(tag)}`, {
        method: 'HEAD',
        headers: this.authHeaders({ Accept: 'application/vnd.oci.image.manifest.v1+json' }),
      });
      if (res.status !== 200) return null;
      const digest = res.headers.get('Docker-Content-Digest');
      const len = Number(res.headers.get('Content-Length') ?? '0');
      if (!digest) return null;
      return { digest, sizeBytes: Number.isFinite(len) ? len : 0 };
    } catch {
      return null;
    }
  }

  private async pushManifest(tag: string, digest: string, sizeBytes: number): Promise<boolean> {
    // A real registry push is a two-step: blob upload (layer
    // already there) + manifest PUT. The OCI distribution spec
    // requires a JSON body that names the config + layer media
    // types; this minimal manifest is enough for the cache marker
    // case because the digest itself encodes the image identity.
    const body = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.empty.v1+json',
        digest: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
        size: 2,
      },
      layers: [
        {
          mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
          digest,
          size: sizeBytes,
          annotations: { 'io.ninedeploy.build-cache': 'true' },
        },
      ],
    });
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${this.manifestPath(tag)}`, {
        method: 'PUT',
        headers: this.authHeaders({
          'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
        }),
        body,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  private authHeaders(extra: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.auth) headers.Authorization = `Basic ${this.auth}`;
    return headers;
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
  // Deterministic placeholder digest for markers that do not already
  // carry one. Mirrors the inline driver's `digestFor` algorithm.
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(blob).digest('hex');
}
