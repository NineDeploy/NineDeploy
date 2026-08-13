import { spawn } from 'node:child_process';
import { desc, eq } from 'drizzle-orm';
import { deployments, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../lib/audit.js';
import { logBus } from '../engine/logs.js';
import { resolveUser } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';

const num = (v: string) => Number(v);

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

  // Rollback to a previous deployment (redeploys at that commit SHA).
  app.post('/:id/deploys/:depId/rollback', { onRequest: [app.authenticate] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const depId = num((req.params as { depId: string }).depId);
    const old = await app.db.query.deployments.findFirst({ where: eq(deployments.id, depId) });
    if (!old || old.serviceId !== id) throw notFound('Deployment not found');
    void audit(app.db, req.user!.id, 'deploy.rollback', `#${depId} → ${old.commitSha?.slice(0, 7) ?? '—'}`);
    const [dep] = await app.db
      .insert(deployments)
      .values({
        serviceId: id,
        status: 'queued',
        trigger: 'user',
        commitSha: old.commitSha,
        message: `Rollback to #${depId}`,
      })
      .returning();
    return { deploymentId: dep!.id };
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
  app.get('/:id/exec', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const id = num((req.params as { id: string }).id);
    if (!token || !(await resolveUser(app.db, token))) {
      socket.close(1008, 'unauthorized');
      return;
    }
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc?.runtimeId) {
      socket.close(1008, 'no running container');
      return;
    }

    const child = spawn('docker', ['exec', '-i', svc.runtimeId, 'sh'], {});
    socket.on('message', (data) => child.stdin.write(data as Buffer));
    child.stdout.on('data', (data) => { try { socket.send(data); } catch { /* closed */ } });
    child.stderr.on('data', (data) => { try { socket.send(data); } catch { /* closed */ } });
    socket.on('close', () => child.kill());
    socket.on('error', () => child.kill());
    child.on('exit', () => { try { socket.close(); } catch { /* already closed */ } });
  });
};
