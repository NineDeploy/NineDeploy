import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { buildConfigs, services, type Service } from '@ninedeploy/db';
import { createService, setLimits, updateService } from '@ninedeploy/schemas';
import { capture, run } from '../lib/exec.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { badRequest, notFound, parseId as num } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';
import { composeBuilder } from '../engine/builders/compose.js';
import { dockerBuilder } from '../engine/builders/docker.js';
import { pm2Builder, pm2Logs, pm2Restart, pm2Start, pm2Stop } from '../engine/builders/pm2.js';
import { writeDynamicConfig } from '../engine/proxy.js';

/** Shape a DB row into the API representation (Date → ISO string). */
function serialize(s: Service) {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    slug: s.slug,
    type: s.type,
    status: s.status,
    repoUrl: s.repoUrl,
    branch: s.branch,
    sourceId: s.sourceId,
    image: s.image,
    volumeMount: s.volumeMount,
    commitSha: s.commitSha,
    runtimeId: s.runtimeId,
    healthPath: s.healthPath,
    port: s.port,
    autoUrl: config.wildcardDomain ? `${s.slug}.${config.wildcardDomain}` : null,
    cpuShares: s.cpuShares,
    memLimitMb: s.memLimitMb,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Build-config row → API representation. */
function serializeBuild(b: typeof buildConfigs.$inferSelect) {
  return {
    buildPack: b.buildPack,
    baseDir: b.baseDir,
    installCmd: b.installCmd,
    buildCmd: b.buildCmd,
    startCmd: b.startCmd,
    dockerfilePath: b.dockerfilePath,
  };
}

export const servicesRoutes: FastifyPluginAsync = async (app) => {
  // Every route here requires authentication.
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    // Optional project scoping for the global project switcher (?projectId=).
    const projectId = Number((req.query as { projectId?: string }).projectId);
    const scoped = Number.isInteger(projectId) && projectId > 0 ? projectId : null;
    const rows = await app.db.query.services.findMany({
      orderBy: (s, { desc }) => [desc(s.id)],
      ...(scoped != null && { where: (s, { eq }) => eq(s.projectId, scoped) }),
    });
    // List view omits the build config (detail endpoint joins it); keep the shape stable.
    return rows.map((s) => ({ ...serialize(s), build: null }));
  });

  app.post('/', async (req) => {
    const input = createService.parse(req.body);
    const slug = input.slug ?? slugify(input.name);
    const [svc] = await app.db
      .insert(services)
      .values({
        projectId: input.projectId ?? null,
        name: input.name,
        slug,
        type: input.type,
        repoUrl: input.repoUrl,
        branch: input.branch,
        sourceId: input.sourceId ?? null,
        image: input.image ?? null,
        volumeMount: input.volumeMount ?? null,
        cpuShares: input.cpuShares ?? 0,
        memLimitMb: input.memLimitMb ?? 0,
        port: input.port ?? null,
      })
      .returning();
    if (!svc) throw notFound('Could not create service');
    await app.db
      .insert(buildConfigs)
      .values({
        serviceId: svc.id,
        buildPack: input.build.buildPack,
        baseDir: input.build.baseDir,
        installCmd: input.build.installCmd ?? null,
        buildCmd: input.build.buildCmd ?? null,
        startCmd: input.build.startCmd ?? null,
        dockerfilePath: input.build.dockerfilePath ?? null,
      });
    void audit(app.db, req.user!.id, 'service.create', input.name);
    return serialize(svc);
  });

  app.get('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    const build = await app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, id) });
    return { ...serialize(svc), build: build ? serializeBuild(build) : null };
  });

  app.patch('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const { build, ...patch } = updateService.parse(req.body ?? {});
    // Build-config keys are optional; null out omitted-but-cleared ones via `set` semantics.
    const [svc] = await app.db.update(services).set(patch).where(eq(services.id, id)).returning();
    if (!svc) throw notFound('Service not found');
    if (build) {
      // Only overwrite the keys the client sent — a PATCH must not reset the
      // rest of the build config back to defaults.
      const values: Partial<typeof buildConfigs.$inferInsert> = {};
      if (build.buildPack !== undefined) values.buildPack = build.buildPack;
      if (build.baseDir !== undefined) values.baseDir = build.baseDir;
      for (const key of ['installCmd', 'buildCmd', 'startCmd', 'dockerfilePath'] as const) {
        const v = build[key];
        if (v !== undefined) values[key] = v === '' ? null : v;
      }
      if (Object.keys(values).length > 0) {
        const updated = await app.db.update(buildConfigs).set(values).where(eq(buildConfigs.serviceId, id)).returning();
        if (updated.length === 0) throw notFound('Service not found');
      }
    }
    void audit(app.db, req.user!.id, 'service.update', svc.name);
    return serialize(svc);
  });

  app.delete('/:id', async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    // Row first (a single DELETE is atomic; FK cascade removes the build
    // config, env vars, domains and deployments) — a failed delete must never
    // leave a live row whose runtime has already been destroyed.
    await app.db.delete(services).where(eq(services.id, id));
    // Rewrite Traefik routing — the service's domains cascade-deleted with the
    // row, so its routers/services drop out of the dynamic config. Routing must
    // never block delete, so failures are logged, not thrown.
    try {
      await writeDynamicConfig(app.db);
    } catch (err) {
      req.log.warn({ err }, 'failed to rewrite traefik config after service delete');
    }
    // Retire the runtime AFTER the row commit — mirrors the blue-green rule
    // (routing flips before the old container stops). Both builders' `stop` is
    // contractually non-throwing (they swallow missing/dead runtimes). An
    // unknown type cannot silently misroute to the docker teardown.
    if (svc.runtimeId) {
      if (svc.type === 'pm2') await pm2Builder.stop(svc.runtimeId);
      else if (svc.type === 'docker') await dockerBuilder.stop(svc.runtimeId);
      else if (svc.type === 'compose') await composeBuilder.stop(svc.runtimeId);
      else req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — leaving runtime in place');
    }
    void audit(app.db, req.user!.id, 'service.delete', svc.name);
    reply.status(204);
  });

  // Resource limits (applied on next deploy).
  app.patch('/:id/limits', async (req) => {
    const id = num((req.params as { id: string }).id);
    const input = setLimits.parse(req.body);
    const [svc] = await app.db.update(services).set(input).where(eq(services.id, id)).returning();
    if (!svc) throw notFound('Service not found');
    return { cpuShares: svc.cpuShares, memLimitMb: svc.memLimitMb };
  });

  // ── Lifecycle: stop / start / restart ──────────────────────────────────
  // PM2 services run as host processes under the PM2 daemon and must be
  // managed through it — `docker stop/start/restart` would silently no-op on a
  // PM2 process name. Docker services are managed through the docker CLI.
  app.post('/:id/stop', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    // PM2 and Docker have disjoint runtimes — an unknown type must not silently
    // misroute to the docker CLI (which would no-op on a PM2 process name).
    if (svc.type === 'pm2') {
      await pm2Stop(svc.runtimeId).catch((err) =>
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'failed to stop pm2 process'));
    } else if (svc.type === 'docker' || svc.type === 'compose') {
      await run('docker', ['stop', '-t', '5', svc.runtimeId], {}, () => {}).catch((err) =>
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'failed to stop docker container'));
    } else {
      req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — cannot stop runtime');
      throw badRequest('Unsupported service type');
    }
    await app.db.update(services).set({ status: 'stopped' }).where(eq(services.id, svc.id));
    void audit(app.db, req.user!.id, 'service.stop', svc.name);
    return { ok: true, status: 'stopped' };
  });

  app.post('/:id/start', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    if (svc.type === 'pm2') {
      await pm2Start(svc.runtimeId).catch((err) =>
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'failed to start pm2 process'));
    } else if (svc.type === 'docker' || svc.type === 'compose') {
      await run('docker', ['start', svc.runtimeId], {}, () => {}).catch((err) =>
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'failed to start docker container'));
    } else {
      req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — cannot start runtime');
      throw badRequest('Unsupported service type');
    }
    await app.db.update(services).set({ status: 'running' }).where(eq(services.id, svc.id));
    void audit(app.db, req.user!.id, 'service.start', svc.name);
    return { ok: true, status: 'running' };
  });

  app.post('/:id/restart', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    if (svc.type === 'pm2') {
      await pm2Restart(svc.runtimeId).catch((err) =>
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'failed to restart pm2 process'));
    } else if (svc.type === 'docker' || svc.type === 'compose') {
      await run('docker', ['restart', svc.runtimeId], {}, () => {}).catch((err) =>
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'failed to restart docker container'));
    } else {
      req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — cannot restart runtime');
      throw badRequest('Unsupported service type');
    }
    void audit(app.db, req.user!.id, 'service.restart', svc.name);
    return { ok: true, status: 'running' };
  });

  // Runtime logs: PM2 reads the daemon's log files; Docker reads container logs.
  app.get('/:id/logs', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    if (svc.type === 'pm2') {
      try {
        return { lines: await pm2Logs(svc.runtimeId) };
      } catch {
        return { lines: '' };
      }
    }
    try {
      const out = await capture('docker', ['logs', '--tail', '300', '--timestamps', svc.runtimeId]);
      return { lines: out };
    } catch {
      return { lines: '' };
    }
  });
};
