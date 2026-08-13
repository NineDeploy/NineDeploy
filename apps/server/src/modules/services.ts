import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { buildConfigs, services, type Service } from '@ninedeploy/db';
import { createService, setLimits, updateService } from '@ninedeploy/schemas';
import { capture, run } from '../lib/exec.js';
import { notFound } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

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
    port: s.port,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const num = (v: string) => Number(v);

export const servicesRoutes: FastifyPluginAsync = async (app) => {
  // Every route here requires authentication.
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const rows = await app.db.query.services.findMany({ orderBy: (s, { desc }) => [desc(s.id)] });
    return rows.map(serialize);
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
    return serialize(svc);
  });

  app.get('/:id', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc) throw notFound('Service not found');
    return serialize(svc);
  });

  app.patch('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const { build, ...patch } = updateService.parse(req.body ?? {});
    if (build) {
      // Build config updates land in F2 alongside the engine.
    }
    const [svc] = await app.db.update(services).set(patch).where(eq(services.id, id)).returning();
    if (!svc) throw notFound('Service not found');
    return serialize(svc);
  });

  app.delete('/:id', async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    await app.db.delete(services).where(eq(services.id, id));
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
  app.post('/:id/stop', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    await run('docker', ['stop', '-t', '5', svc.runtimeId], {}, () => {}).catch(() => undefined);
    await app.db.update(services).set({ status: 'stopped' }).where(eq(services.id, svc.id));
    return { ok: true, status: 'stopped' };
  });

  app.post('/:id/start', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    await run('docker', ['start', svc.runtimeId], {}, () => {}).catch(() => undefined);
    await app.db.update(services).set({ status: 'running' }).where(eq(services.id, svc.id));
    return { ok: true, status: 'running' };
  });

  app.post('/:id/restart', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    await run('docker', ['restart', svc.runtimeId], {}, () => {}).catch(() => undefined);
    return { ok: true, status: 'running' };
  });

  // Runtime container logs (docker logs --tail).
  app.get('/:id/logs', async (req) => {
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, num((req.params as { id: string }).id)) });
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    try {
      const out = await capture('docker', ['logs', '--tail', '300', '--timestamps', svc.runtimeId]);
      return { lines: out };
    } catch {
      return { lines: '' };
    }
  });
};
