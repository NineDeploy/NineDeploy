import { and, asc, eq } from 'drizzle-orm';
import { deployments } from '@ninedeploy/db';
import fp from 'fastify-plugin';
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

/** Background worker: polls for `queued` deployments and runs the pipeline (one at a time). */
export default fp(
  async (fastify) => {
    let running = true;
    let current: Promise<void> = Promise.resolve();
    let timer: NodeJS.Timeout | undefined;

    // Crash recovery: a deploy interrupted by a restart is left stranded in
    // `building`. Mark it failed so it can never hang forever. `queued` rows are
    // deliberately left alone — they have not started yet and will resume on the
    // next poll, so a restart does not silently drop pending work.
    try {
      await fastify.db
        .update(deployments)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(eq(deployments.status, 'building'));
    } catch (err) {
      fastify.log.warn({ err }, 'could not sweep stale building deployments');
    }

    const tick = async () => {
      if (!running) return;
      try {
        const [queued] = await fastify.db
          .select({ id: deployments.id })
          .from(deployments)
          .where(eq(deployments.status, 'queued'))
          .orderBy(asc(deployments.createdAt))
          .limit(1);

        if (queued) {
          // Atomically claim: only flip queued→building if still queued, then
          // verify we won the claim via rowsAffected. A single-row update
          // affects exactly 1 row on success, so `=== 1` is a precise win test.
          // This keeps a future multi-worker setup from double-running a deploy.
          const claimed = (await fastify.db
            .update(deployments)
            .set({ status: 'building' })
            .where(and(eq(deployments.id, queued.id), eq(deployments.status, 'queued')))) as
            | { rowsAffected?: number }
            | undefined;

          if (claimed?.rowsAffected === 1) {
            fastify.log.info({ deploymentId: queued.id }, 'processing deployment');
            current = runDeployment(fastify.db, queued.id);
            await current;
          } else {
            fastify.log.info({ deploymentId: queued.id }, 'deployment already claimed, skipping');
          }
        }
      } catch (err) {
        fastify.log.error({ err }, 'worker tick failed');
      } finally {
        if (running) timer = setTimeout(() => void tick(), POLL_MS);
      }
    };

    fastify.decorate('worker', {
      stop: async () => {
        running = false;
        clearTimeout(timer);
        // Wait for an in-flight deploy, but only up to a bounded grace period.
        // The grace timer is unref'd so it can never keep the process alive.
        const grace = new Promise<void>((resolve) => {
          const t = setTimeout(resolve, STOP_GRACE_MS);
          t.unref();
        });
        await Promise.race([current.catch(() => undefined), grace]);
      },
    });
    fastify.addHook('onClose', async () => {
      await fastify.worker.stop();
    });

    timer = setTimeout(() => void tick(), POLL_MS);
    fastify.log.info('deploy worker started');
  },
  { name: 'ninedeploy-worker' },
);
