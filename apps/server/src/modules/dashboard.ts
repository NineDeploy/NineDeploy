import { count, desc, eq } from 'drizzle-orm';
import { databases, deployments, domains, services, webhooks } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { capture } from '../lib/exec.js';

interface HealthStatus {
  serviceId: number;
  name: string;
  slug: string;
  type: string;
  status: string;
  healthy: boolean;
  responseMs: number | null;
  port: number | null;
  runtimeId: string | null;
  commitSha: string | null;
  lastDeploy: string | null;
}

/** Probe a single service's health endpoint. */
async function probeHealth(port: number): Promise<{ healthy: boolean; responseMs: number | null }> {
  const start = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
    return { healthy: res.status < 500, responseMs: Date.now() - start };
  } catch {
    return { healthy: false, responseMs: null };
  }
}

/** Dashboard overview: stats + per-service health + recent deploys. */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const allServices = await app.db.select().from(services);
    const allDbs = await app.db.select().from(databases);

    // Aggregate counts
    const [svcCount, dbCount, depCount, domCount, hookCount] = await Promise.all([
      app.db.select({ n: count() }).from(services),
      app.db.select({ n: count() }).from(databases),
      app.db.select({ n: count() }).from(deployments),
      app.db.select({ n: count() }).from(domains),
      app.db.select({ n: count() }).from(webhooks),
    ]);

    // Running/stopped/error counts
    const running = allServices.filter((s) => s.status === 'running').length;
    const stopped = allServices.filter((s) => s.status === 'stopped').length;
    const errored = allServices.filter((s) => s.status === 'error').length;
    const dbRunning = allDbs.filter((d) => d.status === 'running').length;

    // Recent deployments (last 5)
    const recentDeploys = await app.db.query.deployments.findMany({
      orderBy: desc(deployments.createdAt),
      limit: 5,
    });
    const svcById = new Map(allServices.map((s) => [s.id, s]));
    const recent = recentDeploys.map((d) => {
      const svc = svcById.get(d.serviceId);
      return {
        id: d.id,
        serviceId: d.serviceId,
        serviceName: svc?.name ?? 'unknown',
        status: d.status,
        commitSha: d.commitSha?.slice(0, 7) ?? null,
        message: d.message,
        trigger: d.trigger,
        finishedAt: d.finishedAt ? d.finishedAt.toISOString() : null,
        createdAt: d.createdAt.toISOString(),
      };
    });

    // Health probe each running service
    const healthStatuses: HealthStatus[] = [];
    for (const svc of allServices) {
      const lastDep = await app.db.query.deployments.findFirst({
        where: eq(deployments.serviceId, svc.id),
        orderBy: desc(deployments.createdAt),
      });

      let healthy = false;
      let responseMs: number | null = null;

      if (svc.status === 'running' && svc.port) {
        const probe = await probeHealth(svc.port);
        healthy = probe.healthy;
        responseMs = probe.responseMs;
      } else if (svc.status === 'stopped') {
        healthy = false;
      } else if (!svc.port) {
        healthy = svc.status === 'running';
      }

      healthStatuses.push({
        serviceId: svc.id,
        name: svc.name,
        slug: svc.slug,
        type: svc.type,
        status: svc.status,
        healthy,
        responseMs,
        port: svc.port,
        runtimeId: svc.runtimeId,
        commitSha: svc.commitSha?.slice(0, 7) ?? null,
        lastDeploy: lastDep?.createdAt.toISOString() ?? null,
      });
    }

    // Docker container count
    let containerCount = 0;
    try {
      containerCount = (await capture('docker', ['ps', '-q'])).split('\n').filter(Boolean).length;
    } catch { /* ignore */ }

    return {
      stats: {
        services: svcCount[0]?.n ?? 0,
        databases: dbCount[0]?.n ?? 0,
        deployments: depCount[0]?.n ?? 0,
        domains: domCount[0]?.n ?? 0,
        webhooks: hookCount[0]?.n ?? 0,
        running,
        stopped,
        errored,
        dbRunning,
        containers: containerCount,
      },
      health: healthStatuses,
      recentDeploys: recent,
    };
  });
};
