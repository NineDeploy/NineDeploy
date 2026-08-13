import { and, asc, eq, gte } from 'drizzle-orm';
import { databases, metrics, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';

const num = (v: string) => Number(v);
const MB = 1024 * 1024;

/** Live resource snapshot: host + every running container mapped to its service/database. */
export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const { containers, host } = app.stats.raw();
    const [svcs, dbs] = await Promise.all([app.db.select().from(services), app.db.select().from(databases)]);

    const out: Array<{
      name: string;
      kind: 'service' | 'database';
      refId: number;
      refName: string;
      engine?: string;
      cpuPct: number;
      memMb: number;
      memLimitMb: number;
    }> = [];

    for (const s of svcs) {
      if (!s.runtimeId) continue;
      const st = containers.get(s.runtimeId);
      if (!st) continue;
      out.push({
        name: s.runtimeId,
        kind: 'service',
        refId: s.id,
        refName: s.name,
        cpuPct: st.cpuPct,
        memMb: +(st.memBytes / MB).toFixed(1),
        memLimitMb: st.memLimitBytes ? Math.round(st.memLimitBytes / MB) : 0,
      });
    }
    for (const d of dbs) {
      if (!d.containerName) continue;
      const st = containers.get(d.containerName);
      if (!st) continue;
      out.push({
        name: d.containerName,
        kind: 'database',
        refId: d.id,
        refName: d.name,
        engine: d.engine,
        cpuPct: st.cpuPct,
        memMb: +(st.memBytes / MB).toFixed(1),
        memLimitMb: st.memLimitBytes ? Math.round(st.memLimitBytes / MB) : 0,
      });
    }
    return { host, containers: out };
  });
};

/** Historical metric series for a service. Mounted under /services. */
export const metricRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/metrics', async (req) => {
    const id = num((req.params as { id: string }).id);
    const q = req.query as { kind?: string; minutes?: string };
    const kind = q.kind === 'memory' ? 'memory' : 'cpu';
    const minutes = Math.min(Math.max(Number(q.minutes ?? 60) || 60, 1), 1440);
    const since = new Date(Date.now() - minutes * 60_000);
    const rows = await app.db.query.metrics.findMany({
      where: and(eq(metrics.serviceId, id), eq(metrics.kind, kind), gte(metrics.ts, since)),
      orderBy: asc(metrics.ts),
      limit: 1000,
    });
    return {
      kind,
      points: rows.map((r) => ({ ts: r.ts.toISOString(), value: r.value })),
    };
  });
};
