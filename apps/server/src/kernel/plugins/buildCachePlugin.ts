import type { KernelContext, KernelPlugin } from '../types.js';

/**
 * Build Cache plugin — Sprint 3, Gap G-01 (PR-A).
 *
 * Watches the `deploy:before` hook firehose and, when the operator
 * has at least one `IBuildCache` registered on the kernel, asks the
 * first one for a hit on the cache key the plugin derives from the
 * service + last successful build. The hit / miss / error is published
 * as a custom event on the bus so the rest of the panel can read it
 * (PR #16 will wire BuildKit; this PR only proves the contract).
 *
 * The plugin NEVER throws. A failing cache is reported as
 * `build.cache.error` and the deploy pipeline runs as if no cache were
 * configured — that is the same defensive pattern `domain-presets`,
 * `metric-history` and `sticky-session` use.
 *
 * Contract:
 *   - `enabled` (default `true`) is the master switch. When `false`,
 *     the listener is set up but every event short-circuits before the
 *     cache backend.
 *   - `cache_name` (default `inline`) picks which `IBuildCache` to use.
 *     Unknown / unset values fall back to the first registered cache
 *     rather than throwing.
 *   - The cache key is a content hash of the service id + repo +
 *     target commit (or "no-commit" for ad-hoc deploys). PR-B will
 *     extend the key with the Dockerfile digest; the shape stays
 *     stable so the panel can render it.
 *   - `destroy()` clears the single `deploy:before` subscription.
 */
export class BuildCachePlugin implements KernelPlugin {
  readonly id = 'build-cache';
  readonly name = 'Build Cache';
  readonly version = '0.1.0';
  readonly description =
    'Looks up the inline / registry / S3 layer cache before each deploy and emits build.cache.hit / miss / error. (G-01)';
  readonly author = 'NineDeploy Core';
  readonly icon = 'Layers';
  readonly isOfficial = true;

  readonly configSchema = [
    {
      key: 'enabled',
      type: 'boolean' as const,
      isSecret: false,
      label: 'Enable Build Cache',
      category: 'plugin:build-cache',
      defaultValue: true,
      description: 'Master switch. When false, the plugin observes deploy:before but never queries the cache.',
      tags: ['build', 'cache'],
    },
    {
      key: 'cache_name',
      type: 'string' as const,
      isSecret: false,
      label: 'Active Cache Backend',
      category: 'plugin:build-cache',
      defaultValue: 'inline',
      description:
        'Stable name of the `IBuildCache` to query. Unknown / empty values fall back to the first registered cache.',
      tags: ['build', 'cache', 'backend'],
    },
  ];

  readonly menuItems = [
    {
      id: 'build-cache-command',
      slot: 'command:palette' as const,
      label: 'Build Cache',
      route: '/settings?section=plugins',
      icon: 'Layers',
      order: 91,
      permission: 'admin' as const,
    },
  ];

  private unsubs: Array<() => void> = [];

  init(ctx: KernelContext): void {
    // `deploy:before` is a SYNCHRONOUS hook (see `HookDefinitions`). The
    // plugin listens with `events.on` because the cache is a firehose
    // event, not a hook — we want to observe every trigger without
    // becoming part of the build pipeline's stop-the-world checkpoints.
    const unsub = ctx.events.on('service.deploying', (payload) => {
      const record = payload as { serviceId?: number; deployId?: number };
      const serviceId = record.serviceId;
      if (typeof serviceId !== 'number') return;
      void this.announce(ctx, serviceId);
    });
    this.unsubs.push(unsub);

    // Sprint 4 G-01 PR-B: also subscribe to the post-deploy hook so a
    // successful build can be recorded in the cache. The deploy
    // pipeline fires this with `{ serviceId, imageDigest }`; we
    // forward the digest into the active cache so the next build
    // hits.
    const postUnsub = ctx.events.on('service.deployed', (payload) => {
      const record = payload as { serviceId?: number; status?: string };
      if (record.status !== 'success') return;
      if (typeof record.serviceId !== 'number') return;
      // No digest available on the event itself in PR-B; the build
      // pipeline calls POST /v1/build-cache/store directly when the
      // BuildKit path produces a digest. This listener exists for
      // symmetry with the pre-deploy path and is the hook Sprint 5's
      // CI integration will fire.
    });
    this.unsubs.push(postUnsub);
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }

  /**
   * Exposed for tests + the `/v1/build-cache/stats` route. Resolves the
   * active cache per the config-center rules, then merges stats across
   * all registered caches when the operator did not pin a specific
   * one.
   */
  async aggregateStats(ctx: KernelContext): Promise<{
    backends: Array<{
      name: string;
      entries: number;
      totalBytes: number;
      hits: number;
      misses: number;
      stores: number;
      evictions: number;
    }>;
    totals: {
      entries: number;
      totalBytes: number;
      hits: number;
      misses: number;
      stores: number;
      evictions: number;
    };
  }> {
    const backends = ctx.registry.listBuildCaches();
    if (backends.length === 0) {
      return {
        backends: [],
        totals: { entries: 0, totalBytes: 0, hits: 0, misses: 0, stores: 0, evictions: 0 },
      };
    }
    const rows = await Promise.all(
      backends.map(async (b) => {
        const s = await b.stats();
        return { name: b.name, ...s };
      }),
    );
    const totals = rows.reduce(
      (acc, r) => ({
        entries: acc.entries + r.entries,
        totalBytes: acc.totalBytes + r.totalBytes,
        hits: acc.hits + r.hits,
        misses: acc.misses + r.misses,
        stores: acc.stores + r.stores,
        evictions: acc.evictions + r.evictions,
      }),
      { entries: 0, totalBytes: 0, hits: 0, misses: 0, stores: 0, evictions: 0 },
    );
    return { backends: rows, totals };
  }

  private async announce(ctx: KernelContext, serviceId: number): Promise<void> {
    try {
      const [enabled, cacheName] = await Promise.all([
        ctx.configCenter.get<boolean>('plugin:build-cache:enabled', true),
        ctx.configCenter.get<string>('plugin:build-cache:cache_name', 'inline'),
      ]);
      if (!enabled) return;
      const cache = ctx.registry.getBuildCache(cacheName) ?? ctx.registry.listBuildCaches()[0];
      if (!cache) return; // no cache configured → silent no-op

      const key = buildKey(serviceId);
      const hit = await cache.lookup(key);
      if (hit) {
        ctx.events.emitCustom('build.cache.hit', {
          serviceId,
          cache: cache.name,
          key,
          digest: hit.digest,
          sizeBytes: hit.sizeBytes,
          ts: Date.now(),
        });
      } else {
        ctx.events.emitCustom('build.cache.miss', {
          serviceId,
          cache: cache.name,
          key,
          ts: Date.now(),
        });
      }
    } catch (err) {
      ctx.events.emitCustom('build.cache.error', {
        serviceId,
        reason: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
    }
  }
}

/**
 * Deterministic cache key per service. The shape is stable so the
 * panel can render it; PR-B will hash in the Dockerfile + dependency
 * lockfile contents to give a true content-addressed key.
 */
export function buildKey(serviceId: number, targetCommit?: string): string {
  return `service:${serviceId}:${targetCommit ?? 'no-commit'}`;
}
