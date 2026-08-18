import { and, asc, eq, gte } from 'drizzle-orm';
import { databases, metrics, services } from '@ninedeploy/db';
import { metricQuery } from '@ninedeploy/schemas';
import type { FastifyPluginAsync } from 'fastify';
import { parseId as num } from '../lib/errors.js';

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
      const candidates = [
        s.runtimeId,
        `nd-app-${s.slug}`,
        `nd-svc-${s.slug}`,
        s.slug,
        s.name,
      ].filter(Boolean) as string[];
      let st = candidates.map((c) => containers.get(c)).find(Boolean);
      if (!st && s.runtimeId) {
        for (const [k, v] of containers.entries()) {
          if (k.startsWith(s.runtimeId) || s.runtimeId.startsWith(k)) {
            st = v;
            break;
          }
        }
      }
      if (!st) continue;
      out.push({
        name: s.runtimeId || `nd-app-${s.slug}`,
        kind: 'service',
        refId: s.id,
        refName: s.name,
        cpuPct: st.cpuPct,
        memMb: +(st.memBytes / MB).toFixed(1),
        memLimitMb: st.memLimitBytes ? Math.round(st.memLimitBytes / MB) : 0,
      });
    }
    for (const d of dbs) {
      const candidates = [
        d.containerName,
        `nd-db-${d.slug}`,
        `nd-db-${d.name}`,
        d.slug,
        d.name,
      ].filter(Boolean) as string[];
      let st = candidates.map((c) => containers.get(c)).find(Boolean);
      if (!st && d.containerName) {
        for (const [k, v] of containers.entries()) {
          if (k.startsWith(d.containerName) || d.containerName.startsWith(k)) {
            st = v;
            break;
          }
        }
      }
      if (!st) continue;
      out.push({
        name: d.containerName || `nd-db-${d.slug}`,
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
      value: kind === 'memory' ? Math.round(r.value / (1024 * 1024)) : +(r.value / 100).toFixed(1),
    }));

    // If historical samples haven't been stored yet, fallback to the latest live snapshot
    if (points.length === 0) {
      const { containers } = app.stats.raw();
      const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
      if (svc) {
        const candidates = [
          svc.runtimeId,
          `nd-app-${svc.slug}`,
          `nd-svc-${svc.slug}`,
          svc.slug,
          svc.name,
        ].filter(Boolean) as string[];
        let st = candidates.map((c) => containers.get(c)).find(Boolean);
        if (!st && svc.runtimeId) {
          for (const [k, v] of containers.entries()) {
            if (k.startsWith(svc.runtimeId) || svc.runtimeId.startsWith(k)) {
              st = v;
              break;
            }
          }
        }
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
