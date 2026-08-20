import { and, asc, eq, gte } from 'drizzle-orm';
import { databases, metrics, services } from '@ninedeploy/db';
import { metricQuery } from '@ninedeploy/schemas';
import type { FastifyPluginAsync } from 'fastify';
import { parseId as num } from '../lib/errors.js';
import { loadServiceForUser, visibleDatabaseIds } from '../lib/resourceAccess.js';

const MB = 1024 * 1024;

/** Live resource snapshot: host + every running container mapped to its service/database. */
export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const { containers, host } = app.stats.raw();
    const [allServices, allDatabases, visibleDatabases] = await Promise.all([
      app.db.select().from(services),
      app.db.select().from(databases),
      visibleDatabaseIds(app.db, req.user!),
    ]);
    const svcs = req.user!.role === 'admin'
      ? allServices
      : allServices.filter((service) => service.ownerUserId === req.user!.id);
    const dbs = visibleDatabases === null
      ? allDatabases
      : allDatabases.filter((database) => visibleDatabases.includes(database.id));

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
      const cname = s.runtimeId ?? `nd-app-${s.slug}`;
      const st = (s.runtimeId ? containers.get(s.runtimeId) : undefined) ?? containers.get(`nd-app-${s.slug}`);
      if (!st) continue;
      out.push({
        name: cname,
        kind: 'service',
        refId: s.id,
        refName: s.name,
        cpuPct: st.cpuPct,
        memMb: +(st.memBytes / MB).toFixed(1),
        memLimitMb: st.memLimitBytes ? Math.round(st.memLimitBytes / MB) : 0,
      });
    }
    for (const d of dbs) {
      const cname = d.containerName ?? `nd-db-${d.name}`;
      const st = containers.get(cname);
      if (!st) continue;
      out.push({
        name: cname,
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
    await loadServiceForUser(app.db, id, req.user!);
    const q = metricQuery.parse(req.query);
    const kind = q.kind;
    const minutes = q.minutes;
    const since = new Date(Date.now() - minutes * 60_000);
    const rows = await app.db.query.metrics.findMany({
      where: and(eq(metrics.serviceId, id), eq(metrics.kind, kind), gte(metrics.ts, since)),
      orderBy: asc(metrics.ts),
      limit: 1000,
    });

    let points = rows.map((r) => ({
      ts: r.ts.toISOString(),
      value: kind === 'memory' ? Math.round(r.value / (1024 * 1024)) : r.value / 100,
    }));

    if (points.length === 0) {
      const { containers } = app.stats.raw();
      const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
      if (svc) {
        const st = (svc.runtimeId ? containers.get(svc.runtimeId) : undefined) ?? containers.get(`nd-app-${svc.slug}`);
        if (st) {
          points = [
            {
              ts: new Date().toISOString(),
              value: kind === 'memory' ? Math.round(st.memBytes / (1024 * 1024)) : +st.cpuPct.toFixed(1),
            },
          ];
        }
      }
    }

    return {
      kind,
      points,
    };
  });
};
