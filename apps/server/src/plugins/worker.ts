import { and, asc, eq } from 'drizzle-orm';
import { deployments } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { runDeployment } from '../engine/pipeline.js';

const POLL_MS = 2000;

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
          // Claim atomically so a future multi-worker setup stays safe.
          await fastify.db
            .update(deployments)
            .set({ status: 'building' })
            .where(and(eq(deployments.id, queued.id), eq(deployments.status, 'queued')));
          fastify.log.info({ deploymentId: queued.id }, 'processing deployment');
          current = runDeployment(fastify.db, queued.id);
          await current;
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
        if (timer) clearTimeout(timer);
        await current.catch(() => undefined);
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
