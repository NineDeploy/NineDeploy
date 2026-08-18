import { spawn } from 'node:child_process';
import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { deployments, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { diffLines, renderDiff } from '../lib/diff.js';
import { capture } from '../lib/exec.js';
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
    // In-progress dedup: a service with a queued/building deploy gets that
    // deployment returned instead of another queue entry (button-hammering
    // must not flood unbounded queued rows for one service).
    const existing = await app.db.query.deployments.findFirst({
      where: and(
        eq(deployments.serviceId, id),
        inArray(deployments.status, ['queued', 'building']),
      ),
      orderBy: desc(deployments.id),
    });
    if (existing) return { deploymentId: existing.id, alreadyInProgress: true };
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
      // id is monotonic and unambiguous — createdAt is second-precision, so
      // ordering by it ties for same-second deploys.
      orderBy: desc(deployments.id),
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

  // Config diff: what changed between this deployment and the previous one
  // (build config + env key fingerprint). Secret VALUES are never snapshotted —
  // only key names (marked with *).
  app.get('/:id/deploys/:depId/diff', { onRequest: [app.authenticate] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const depId = num((req.params as { depId: string }).depId);
    const dep = await app.db.query.deployments.findFirst({ where: eq(deployments.id, depId) });
    if (!dep || dep.serviceId !== id) throw notFound('Deployment not found');
    // The nearest OLDER deployment of the same service with a snapshot.
    const prev = await app.db.query.deployments.findFirst({
      where: and(eq(deployments.serviceId, id), lt(deployments.id, depId), isNotNull(deployments.configSnapshot)),
      orderBy: desc(deployments.id),
    });
    const current = dep.configSnapshot ? JSON.parse(dep.configSnapshot) as Record<string, unknown> : null;
    const previous = prev?.configSnapshot ? JSON.parse(prev.configSnapshot!) as Record<string, unknown> : null;
    const ops = diffLines(
      previous ? Object.entries(previous).map(([k, v]) => `${k}: ${JSON.stringify(v)}`) : [],
      current ? Object.entries(current).map(([k, v]) => `${k}: ${JSON.stringify(v)}`) : [],
    );
    return {
      deploymentId: depId,
      previousDeploymentId: prev?.id ?? null,
      changed: ops.some((op) => op.kind !== 'same'),
      diff: renderDiff(ops),
    };
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
        socket.send(`${line}\n`);
      } catch {
        /* socket closed */
      }
    });
    socket.on('close', unsub);
    socket.on('error', unsub);
  });

  // Container exec — interactive shell via WebSocket (`docker exec -it`).
  // Admin-only + audited: this is a root shell inside the service container
  // (it can read env vars incl. DB credentials and mounted data).
  //
  // TTY: `docker exec -t` requires the docker client's stdio to be a tty, which
  // a plain Node pipe is not — without one the shell has no prompt, no echo
  // and no line editing, which reads as "terminal is broken". When python3 is
  // available we wrap docker in `pty.spawn(...)` (real pty, full interactivity);
  // otherwise we fall back to the legacy pipe mode (works, just less shell-like).
  // Probed per connection (~30ms) — cheap next to a WS handshake.
  const isPtyAvailable = async (): Promise<boolean> => {
    if (process.platform === 'win32') return false;
    try {
      await capture('python3', ['-c', 'import pty']);
      return true;
    } catch {
      return false;
    }
  };

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
    if (!svc) {
      socket.close(1008, 'service not found');
      return;
    }
    const targetContainer = svc.runtimeId || `nd-app-${svc.slug}`;
    void audit(app.db, user.id, 'service.exec', svc.name);

    socket.send(`\x1b[36m⚡ Attached to container shell [${targetContainer}]\x1b[0m\r\n`);

    // The container name reaches python via the environment — never through
    // the command string — so a hostile-looking runtimeId can't inject options.
    // Both docker invocations use `--` before the dynamic container name.
    const hasPty = await isPtyAvailable();
    const child = hasPty
      ? spawn(
          'python3',
          ['-c', 'import os,pty; pty.spawn(["docker","exec","-i","-t","-e","TERM=xterm","--",os.environ["ND_EXEC_CONTAINER"],"sh"])'],
          {
            env: { ...process.env, ND_EXEC_CONTAINER: targetContainer },
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
      : spawn('docker', ['exec', '-i', '-e', 'TERM=xterm', '--', targetContainer, 'sh', '-i'], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

    // Absorb EPIPE on stdin: a keystroke racing the child's exit must never
    // crash the process (unhandled 'error' on a stream is fatal).
    child.stdin.on('error', () => { /* child already gone */ });
    child.on('error', (err) => {
      try {
        socket.send(`\r\n\x1b[31m✕ Failed to spawn container shell: ${err.message}\x1b[0m\r\n`);
        socket.close();
      } catch {
        /* already closed */
      }
    });

    socket.on('message', (data) => {
      if (child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.write(data as Buffer);
        } catch {
          // ignore
        }
      }
    });

    child.stdout.on('data', (data) => {
      try {
        socket.send(data);
      } catch {
        /* closed */
      }
    });

    child.stderr.on('data', (data) => {
      try {
        socket.send(data);
      } catch {
        /* closed */
      }
    });

    socket.on('close', () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    });

    socket.on('error', () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    });

    child.on('exit', () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    });
  });
};
