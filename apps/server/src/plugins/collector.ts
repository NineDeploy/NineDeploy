import { lt } from 'drizzle-orm';
import { metrics, services } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { collectContainerStats, collectHostStats, type ContainerStat, type HostStat } from '../lib/stats.js';
import { evaluateAlerts, type MetricSnapshot } from '../lib/alerting.js';
import { readCertificates } from '../engine/proxy.js';

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

        // Feed the alert evaluator in rule units (cpu %, memory MiB; null = host).
        const snapshots: MetricSnapshot[] = rows.map((r) => ({
          serviceId: r.serviceId,
          kind: r.kind,
          value: r.kind === 'memory' ? Math.round(r.value / (1024 * 1024)) : r.value,
        }));
        if (cache.host) {
          const h = cache.host;
          const memUsedPct = h.memTotalBytes > 0 ? Math.round((h.memUsedBytes / h.memTotalBytes) * 100) : 0;
          snapshots.push({ serviceId: null, kind: 'cpu', value: memUsedPct || Math.round(h.load1 * 10) });
          snapshots.push({ serviceId: null, kind: 'memory', value: Math.round(h.memUsedBytes / (1024 * 1024)) });
        }

        // Cert-expiry alerting: the least days remaining across all issued certs.
        const certExpiries = readCertificates()
          .map((c) => c.expiresAt)
          .filter((d): d is Date => d !== null);
        if (certExpiries.length) {
          const minDays = Math.floor((Math.min(...certExpiries.map((d) => d.getTime())) - now.getTime()) / 86_400_000);
          snapshots.push({ serviceId: null, kind: 'cert-expiry', value: minDays });
        }

        await evaluateAlerts(fastify.db, snapshots);

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
      clearTimeout(timer);
    });

    timer = setTimeout(() => void tick(), 5000);
    fastify.log.info('metrics collector started');
  },
  { name: 'ninedeploy-collector' },
);
