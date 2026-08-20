import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { deployments, services } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { config } from '../config.js';
import { runDeployment } from '../engine/pipeline.js';

const POLL_MS = 2000;
/** Bounded grace period for an in-flight deploy during graceful shutdown. The
 *  exec layer already tree-kills hung subprocesses on their own timeouts, so
 *  this is a backstop, not the primary guard against stuck deploys. */
const STOP_GRACE_MS = 60_000;

declare module 'fastify' {
  interface FastifyInstance {
    worker: { stop: () => Promise<void> };
  }
}

/** Background worker: polls for `queued` deployments and runs the pipeline.
 *
 * Concurrency model:
 *   • `NINEDEPLOY_DEPLOY_CONCURRENCY` independent claim loops (default 1).
 *   • Each loop claims atomically (queued→building UPDATE guarded by
 *     rowsAffected === 1), so loops — and any future second process sharing
 *     the database — can never double-run a deployment.
 *   • The claim query skips services with a `building` deployment, so the
 *     same service is never deployed concurrently.
 */
export default fp(
  async (fastify) => {
    let running = true;
    const currents: Array<Promise<void>> = [];
    const timers: NodeJS.Timeout[] = [];

    // Crash recovery: a deploy interrupted by a restart is left stranded in
    // `building`. Requeue rows that can no longer be genuinely running —
    // a second process sharing this DB may have live in-flight deploys, and
    // failing those out from under it would break the multi-process story.
    // 45 min comfortably covers the 30-min exec timeout + 5-min healthcheck.
    const STALE_BUILDING_MS = 45 * 60 * 1000;
    const staleCutoff = new Date(Date.now() - STALE_BUILDING_MS);
    try {
      const buildingRows = (await fastify.db.select().from(deployments).where(eq(deployments.status, 'building'))) as Array<{
        id: number;
        message: string | null;
        startedAt: Date | null;
        createdAt: Date | null;
      }>;
      const stale = buildingRows
        .filter((r) => {
          // v0.2.34 let the browser own dependency provisioning and left this
          // marker behind if that request was interrupted. No worker can be
          // running such a row, so migrate it immediately regardless of age.
          if (r.message?.startsWith('Provisioning template dependencies:')) return true;
          const ts = r.startedAt ?? r.createdAt;
          return !!ts && ts.getTime() < staleCutoff.getTime();
        })
        .map((r) => r.id);
      if (stale.length) {
        await fastify.db
          .update(deployments)
          .set({ status: 'queued', startedAt: null, finishedAt: null, message: 'Automatically resumed after interrupted worker' })
          .where(inArray(deployments.id, stale));
      }
    } catch (err) {
      fastify.log.warn({ err }, 'could not sweep stale building deployments');
    }

    /** The oldest queued deployment of a service with nothing in `building`,
     * whose SERVER partition still has a free concurrency slot. Deploys are
     * partitioned by the service's target server (null = this host): each
     * partition independently gets `deployConcurrency` build slots, so a long
     * build on a remote server never starves local deployments. */
    const nextClaimable = async (): Promise<{ id: number } | undefined> => {
      const buildingServices = fastify.db
        .select({ serviceId: deployments.serviceId })
        .from(deployments)
        .where(eq(deployments.status, 'building'));
      // Build counts per partition (serverId; null → 0 = local).
      const buildingRows = await fastify.db
        .select({ serverId: services.serverId })
        .from(deployments)
        .innerJoin(services, eq(services.id, deployments.serviceId))
        .where(eq(deployments.status, 'building'));
      const perPartition = new Map<string, number>();
      for (const r of buildingRows) {
        const key = String(r.serverId ?? 0);
        perPartition.set(key, (perPartition.get(key) ?? 0) + 1);
      }
      // Candidate queue, oldest first.
      const queued = await fastify.db
        .select({ id: deployments.id, serverId: services.serverId })
        .from(deployments)
        .innerJoin(services, eq(services.id, deployments.serviceId))
        .where(and(eq(deployments.status, 'queued'), notInArray(deployments.serviceId, buildingServices)))
        .orderBy(asc(deployments.createdAt));
      for (const row of queued) {
        const key = String(row.serverId ?? 0);
        if ((perPartition.get(key) ?? 0) < config.deployConcurrency) return { id: row.id };
      }
      return undefined;
    };

    const tick = async () => {
      if (!running) return;
      try {
        const queued = await nextClaimable();
        if (queued) {
          // Atomically claim: only flip queued→building if still queued, then
          // verify we won the claim via rowsAffected. A single-row update
          // affects exactly 1 row on success, so `=== 1` is a precise win test.
          // This keeps multiple loops / workers from double-running a deploy.
          const claimed = (await fastify.db
            .update(deployments)
            .set({ status: 'building' })
            .where(and(eq(deployments.id, queued.id), eq(deployments.status, 'queued')))) as
            | { rowsAffected?: number }
            | undefined;

          if (claimed?.rowsAffected === 1) {
            fastify.log.info({ deploymentId: queued.id }, 'processing deployment');
            const run = runDeployment(fastify.db, queued.id);
            currents.push(run);
            try {
              await run;
            } finally {
              // Drop the settled entry so stop() waits only on live work.
              // indexOf always finds it: we pushed before awaiting.
              currents.splice(currents.indexOf(run), 1);
            }
          } else {
            fastify.log.info({ deploymentId: queued.id }, 'deployment already claimed, skipping');
          }
        }
      } catch (err) {
        fastify.log.error({ err }, 'worker tick failed');
      } finally {
        if (running) {
          const t = setTimeout(() => void tick(), POLL_MS);
          t.unref?.();
          timers.push(t);
        }
      }
    };

    fastify.decorate('worker', {
      stop: async () => {
        running = false;
        for (const t of timers.splice(0)) clearTimeout(t);
        // Wait for in-flight deploys, but only up to a bounded grace period.
        // The grace timer is unref'd so it can never keep the process alive.
        const grace = new Promise<void>((resolve) => {
          const t = setTimeout(resolve, STOP_GRACE_MS);
          t.unref();
        });
        await Promise.race([
          Promise.allSettled([...currents]).then(() => undefined),
          grace,
        ]);
      },
    });
    fastify.addHook('onClose', async () => {
      await fastify.worker.stop();
    });

    // One loop per concurrency slot; all loops share the same claim guard.
    for (let slot = 0; slot < config.deployConcurrency; slot++) {
      const t = setTimeout(() => void tick(), POLL_MS + slot * 100);
      t.unref?.();
      timers.push(t);
    }
    fastify.log.info({ concurrency: config.deployConcurrency }, 'deploy worker started');
  },
  { name: 'ninedeploy-worker' },
);
