import { count, desc, eq } from 'drizzle-orm';
import { databases, deployments, domains, services, webhooks } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { capture } from '../lib/exec.js';
import { containerIp } from '../engine/builders/docker.js';
import { TRAEFIK_CONTAINER } from '../engine/proxy.js';
import { buildProbeUrl, safeProbePath } from '../lib/probeUrl.js';
import { ensureDockerImage } from '../lib/dockerPull.js';

const NETNS_PROBE_IMAGE = 'curlimages/curl:latest';

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

/** Probe a URL with a short per-attempt timeout (never blocks the request). */
async function probeUrl(url: string, timeoutMs = 3000): Promise<{ healthy: boolean; responseMs: number | null }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { healthy: res.status < 500, responseMs: Date.now() - start };
  } catch {
    return { healthy: false, responseMs: null };
  }
}

/**
 * Probe from INSIDE the docker network by exec'ing wget in the Traefik
 * container (alpine base, always running on the shared `ninedeploy` network).
 * This is the portable fallback: hosts that cannot route bridge IPs directly
 * (Docker Desktop / macOS / Windows) would otherwise mark every container
 * unhealthy even though it serves fine on the mesh.
 */
async function probeViaMesh(runtimeId: string, port: number, path: string): Promise<boolean> {
  try {
    await capture('docker', [
      'exec', TRAEFIK_CONTAINER,
      'wget', '-q', '-O', '/dev/null', '-T', '3',
      `http://${runtimeId}:${port}${path}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Last-resort probe for containers that are NOT on the shared mesh (e.g.
 * compose projects run their own network): a throwaway curl container shares
 * the target's network namespace, so 127.0.0.1:<port> lands directly on the
 * app regardless of how the container is networked.
 */
async function probeViaNetns(runtimeId: string, port: number, path: string): Promise<boolean> {
  try {
    await ensureDockerImage(NETNS_PROBE_IMAGE, () => undefined);
    const out = await capture('docker', [
      'run', '--rm', '--network', `container:${runtimeId}`, NETNS_PROBE_IMAGE,
      '-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '3',
      `http://127.0.0.1:${port}${path}`,
    ]);
    const code = Number(out.trim());
    return code > 0 && code < 500;
  } catch {
    return false;
  }
}

/**
 * Probe a running service's health endpoint. Docker services publish no host
 * ports (Traefik is the only ingress, per the container-security model), so
 * they are probed on their container network IP first — the fast path on
 * Linux hosts that can route bridge IPs — and via the Traefik mesh fallback
 * on hosts that cannot. PM2 services are host processes, so they are probed
 * on loopback like before.
 */
async function probeService(svc: {
  type: string;
  runtimeId: string | null;
  port: number;
  healthPath: string;
}): Promise<{ healthy: boolean; responseMs: number | null }> {
  // Never concatenate a stored healthPath onto an origin — see lib/probeUrl.ts.
  const path = safeProbePath(svc.healthPath);
  if (svc.type === 'pm2') return probeUrl(buildProbeUrl('127.0.0.1', svc.port, path));
  const runtimeId = svc.runtimeId;
  if (!runtimeId) return { healthy: false, responseMs: null };
  const ip = await containerIp(runtimeId);
  if (!ip) return { healthy: false, responseMs: null }; // container not running
  // Race the transports: the direct fetch and the mesh probe run CONCURRENTLY
  // and the first healthy answer wins. Waiting for the doomed 1.2s direct
  // timeout before even starting the mesh probe is what made the dashboard
  // slow on hosts that cannot route bridge IPs (Docker Desktop).
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: { healthy: boolean; responseMs: number | null }) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    void probeUrl(buildProbeUrl(ip, svc.port, path), 1200).then((direct) => {
      if (direct.healthy) {
        settle(direct);
      } else {
        // Direct failed — containers outside the mesh need the netns probe.
        void probeViaNetns(runtimeId, svc.port, path).then((ok) => settle({ healthy: ok, responseMs: null }));
      }
    });
    void probeViaMesh(runtimeId, svc.port, path).then((ok) => {
      if (ok) settle({ healthy: true, responseMs: null });
    });
  });
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

    // Recent deployments (last 5) — ordered by id (monotonic; createdAt is
    // second-precision and would tie for same-second deploys).
    const recentDeploys = await app.db.query.deployments.findMany({
      orderBy: desc(deployments.id),
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

    // Health probe each running service — all services IN PARALLEL. Probes
    // chain through up to three transports (direct fetch → mesh → netns) and
    // each hop can cost seconds on hosts that cannot route bridge IPs; a
    // sequential loop multiplied that delay by the service count and made the
    // dashboard take 5-7s to render.
    const healthStatuses = await Promise.all(
      allServices.map(async (svc): Promise<HealthStatus> => {
        const lastDep = await app.db.query.deployments.findFirst({
          where: eq(deployments.serviceId, svc.id),
          orderBy: desc(deployments.id),
        });

        let healthy = false;
        let responseMs: number | null = null;

        if (svc.status === 'running' && svc.port) {
          const probe = await probeService({
            type: svc.type,
            runtimeId: svc.runtimeId,
            port: svc.port,
            healthPath: svc.healthPath,
          });
          healthy = probe.healthy;
          responseMs = probe.responseMs;
        } else if (svc.status === 'stopped') {
          healthy = false;
        } else if (!svc.port) {
          healthy = svc.status === 'running';
        }

        return {
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
        };
      }),
    );

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
