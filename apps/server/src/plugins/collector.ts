import { lt } from 'drizzle-orm';
import { metrics, services } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { collectContainerStats, collectHostStats, type ContainerStat, type HostStat } from '../lib/stats.js';

const INTERVAL_MS = 30_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface StatsCache {
  containers: Map<string, ContainerStat>;
  host: HostStat | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    stats: { raw: () => StatsCache };
  }
}

/** Periodically samples container/host stats, persists service metrics, and caches the latest snapshot. */
export default fp(
  async (fastify) => {
    let cache: StatsCache = { containers: new Map(), host: null };
    let running = true;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      try {
        const containers = await collectContainerStats();
        cache = { containers, host: await collectHostStats() };

        const all = await fastify.db.select().from(services);
        const now = new Date();
        const rows: Array<{ serviceId: number; kind: string; value: number; ts: Date }> = [];
        for (const s of all) {
          if (!s.runtimeId) continue;
          const st = containers.get(s.runtimeId);
          if (!st) continue;
          rows.push({ serviceId: s.id, kind: 'cpu', value: Math.round(st.cpuPct * 100), ts: now });
          rows.push({ serviceId: s.id, kind: 'memory', value: st.memBytes, ts: now });
        }
        if (rows.length) await fastify.db.insert(metrics).values(rows);
        await fastify.db.delete(metrics).where(lt(metrics.ts, new Date(Date.now() - RETENTION_MS)));
      } catch (err) {
        fastify.log.error({ err }, 'metrics collection failed');
      } finally {
        if (running) timer = setTimeout(() => void tick(), INTERVAL_MS);
      }
    };

    fastify.decorate('stats', { raw: () => cache });
    fastify.addHook('onClose', async () => {
      running = false;
      if (timer) clearTimeout(timer);
    });

    timer = setTimeout(() => void tick(), 5000);
    fastify.log.info('metrics collector started');
  },
  { name: 'ninedeploy-collector' },
);
