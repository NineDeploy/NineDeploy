import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  buildConfigs,
  deployments,
  projects,
  serviceProjects,
  serviceWorkspaces,
  services,
} from '@ninedeploy/db';
import { audit } from '../lib/audit.js';

/**
 * The single demo payload: one real, deployable service built from a pinned
 * public GitHub repo (Docker source build — no PM2, no fake rows). Seeding
 * queues the first build so "Load demo" ends with a live app instead of
 * database rows pretending to run.
 */
const DEMO = {
  projectSlug: 'nextjs-demo',
  projectName: 'Next.js Demo',
  slug: 'nextjs-demo',
  name: 'Next.js Demo',
  repoUrl: 'https://github.com/ersinkoc/nextjs-test',
  branch: 'main',
  port: 3000,
  healthPath: '/api/health',
  publishedPort: 3000,
} as const;

export const demoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.post('/seed', { preHandler: [app.requireAdmin] }, async (req) => {
    const userId = req.user!.id;

    let project = await app.db.query.projects.findFirst({
      where: eq(projects.slug, DEMO.projectSlug),
    });
    if (!project) {
      const [insertedProject] = await app.db
        .insert(projects)
        .values({
          name: DEMO.projectName,
          slug: DEMO.projectSlug,
          description: 'Demo app built from its public GitHub repo with Docker',
        })
        .returning();
      project = insertedProject!;
      void audit(app.db, userId, 'project.create', project.name);
    }

    let service = await app.db.query.services.findFirst({
      where: eq(services.slug, DEMO.slug),
    });

    if (!service) {
      const [inserted] = await app.db
        .insert(services)
        .values({
          name: DEMO.name,
          slug: DEMO.slug,
          type: 'docker',
          repoUrl: DEMO.repoUrl,
          branch: DEMO.branch,
          port: DEMO.port,
          healthPath: DEMO.healthPath,
          publishedPort: DEMO.publishedPort,
          status: 'idle',
          cpuShares: 512,
          memLimitMb: 512,
        })
        .returning();
      service = inserted!;

      // The repo ships a root Dockerfile (multi-stage, EXPOSE 3000, its own
      // /api/health healthcheck) — build exactly that.
      await app.db.insert(buildConfigs).values({
        serviceId: service.id,
        buildPack: 'dockerfile',
        baseDir: '/',
        dockerfilePath: 'Dockerfile',
      });

      // Queue the first build right away: the deploy worker turns this row
      // into a real clone → docker build → run.
      await app.db.insert(deployments).values({
        serviceId: service.id,
        status: 'queued',
        trigger: 'user',
        message: 'Initial demo deployment from ersinkoc/nextjs-test',
      });

      void audit(app.db, userId, 'service.create', service.name);

      // Tag the new service into the demo project and the caller's personal
      // workspace (or every workspace for operators). Only on create — a
      // re-seed must not duplicate the tag rows.
      const personalWs = await app.db.query.workspaces.findFirst({
        where: (w, { eq: eqOp, and: andOp }) => andOp(eqOp(w.ownerId, userId), eqOp(w.slug, `personal-${String(userId)}`)),
      });
      const wsIds = personalWs ? [personalWs.id] : (await app.db.query.workspaces.findMany()).map((w) => w.id);
      await app.db.insert(serviceProjects).values({ serviceId: service.id, projectId: project.id });
      for (const wsId of wsIds) {
        await app.db.insert(serviceWorkspaces).values({ serviceId: service.id, workspaceId: wsId });
      }
    }

    return {
      ok: true,
      projectId: project.id,
      projectName: project.name,
      services: [
        {
          id: service.id,
          name: service.name,
          type: service.type,
          status: service.status,
          port: service.port,
        },
      ],
      database: null,
    };
  });
};
