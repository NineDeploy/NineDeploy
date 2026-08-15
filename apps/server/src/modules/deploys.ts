import { spawn } from 'node:child_process';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { deployments, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../lib/audit.js';
import { logBus } from '../engine/logs.js';
import { resolveUser } from '../lib/auth.js';
import { badRequest, notFound, parseId as num } from '../lib/errors.js';

export const deploysRoutes: FastifyPluginAsync = async (app) => {
  // Trigger a new deployment (enqueues a `queued` row the worker picks up).
  app.post('/:id/deploys', { onRequest: [app.authenticate] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    void audit(app.db, req.user!.id, 'deploy.trigger', svc.name);
    const [dep] = await app.db
      .insert(deployments)
      .values({ serviceId: id, status: 'queued', trigger: 'user', message: 'Manual deploy' })
      .returning();
    return { deploymentId: dep!.id };
  });

  // List deployments for a service.
  app.get('/:id/deploys', { onRequest: [app.authenticate] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const rows = await app.db.query.deployments.findMany({
      where: eq(deployments.serviceId, id),
      orderBy: desc(deployments.createdAt),
      limit: 50,
    });
    return rows.map((d) => ({
      id: d.id,
      status: d.status,
      commitSha: d.commitSha,
      message: d.message,
      author: d.author,
      trigger: d.trigger,
      startedAt: d.startedAt ? d.startedAt.toISOString() : null,
      finishedAt: d.finishedAt ? d.finishedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    }));
  });

  // Rollback to a previous deployment. Re-runs the exact commit SHA (repo
  // deploys) or the exact image digest (image deploys) so a moved `:latest`
  // tag can't silently change what gets deployed.
  app.post('/:id/deploys/:depId/rollback', { onRequest: [app.authenticate] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const depId = num((req.params as { depId: string }).depId);
    const old = await app.db.query.deployments.findFirst({ where: eq(deployments.id, depId) });
    if (!old || old.serviceId !== id) throw notFound('Deployment not found');
    void audit(app.db, req.user!.id, 'deploy.rollback', `#${depId} → ${old.commitSha?.slice(0, 7) ?? old.imageDigest?.slice(0, 15) ?? '—'}`);
    const [dep] = await app.db
      .insert(deployments)
      .values({
        serviceId: id,
        status: 'queued',
        trigger: 'user',
        commitSha: old.commitSha,
        imageDigest: old.imageDigest,
        message: `Rollback to #${depId}`,
      })
      .returning();
    return { deploymentId: dep!.id };
  });

  // Cancel a deployment. `queued` rows flip atomically (the worker never claims
  // a cancelled row); `building` rows flip so the pipeline's checkpoints abort
  // at the next step boundary and the previous runtime keeps serving.
  app.post('/:id/deploys/:depId/cancel', { onRequest: [app.authenticate] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const depId = num((req.params as { depId: string }).depId);
    const dep = await app.db.query.deployments.findFirst({ where: eq(deployments.id, depId) });
    if (!dep || dep.serviceId !== id) throw notFound('Deployment not found');
    if (!['queued', 'building', 'deploying'].includes(dep.status)) {
      throw badRequest('Deployment is not in progress');
    }
    const flipped = await app.db
      .update(deployments)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(deployments.id, depId), inArray(deployments.status, ['queued', 'building', 'deploying'])))
      .returning({ id: deployments.id });
    if (flipped.length === 0) throw badRequest('Deployment is not in progress');
    if (dep.status === 'queued') {
      // Never picked up — it is fully cancelled here.
      logBus.publish(depId, '⏹ Cancelled before the worker picked it up');
    } else {
      // In-flight: the pipeline observes the flip at its next checkpoint.
      logBus.publish(depId, '⏹ Cancellation requested — stopping at the next step');
    }
    void audit(app.db, req.user!.id, 'deploy.cancel', `#${depId}`);
    return { ok: true, status: 'cancelled' };
  });

  // Live log stream over WebSocket. Auth via ?token= (ws can't set headers easily).
  app.get('/:id/deploys/:depId/logs', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const depId = num((req.params as { id: string; depId: string }).depId);
    if (!token || !(await resolveUser(app.db, token))) {
      socket.close(1008, 'unauthorized');
      return;
    }

    // Replay backlog, then stream live lines.
    const backlog = logBus.read(depId);
    if (backlog) socket.send(backlog);
    const unsub = logBus.subscribe(depId, (line) => {
      try {
        socket.send(line + '\n');
      } catch {
        /* socket closed */
      }
    });
    socket.on('close', unsub);
    socket.on('error', unsub);
  });

  // Container exec — interactive shell via WebSocket (docker exec -i).
  // Admin-only + audited: this is a root shell inside the service container
  // (it can read env vars incl. DB credentials and mounted data).
  app.get('/:id/exec', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const id = num((req.params as { id: string }).id);
    const user = token ? await resolveUser(app.db, token) : null;
    if (!user) {
      socket.close(1008, 'unauthorized');
      return;
    }
    if (user.role !== 'admin') {
      socket.close(1008, 'admin access required');
      return;
    }
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc?.runtimeId) {
      socket.close(1008, 'no running container');
      return;
    }
    void audit(app.db, user.id, 'service.exec', svc.name);

    const child = spawn('docker', ['exec', '-i', svc.runtimeId, 'sh'], {});
    // Absorb EPIPE on stdin: a keystroke racing the child's exit must never
    // crash the process (unhandled 'error' on a stream is fatal).
    child.stdin.on('error', () => { /* child already gone */ });
    socket.on('message', (data) => { child.stdin.write(data as Buffer); });
    child.stdout.on('data', (data) => { try { socket.send(data); } catch { /* closed */ } });
    child.stderr.on('data', (data) => { try { socket.send(data); } catch { /* closed */ } });
    socket.on('close', () => child.kill());
    socket.on('error', () => child.kill());
    child.on('exit', () => { try { socket.close(); } catch { /* already closed */ } });
  });
};
