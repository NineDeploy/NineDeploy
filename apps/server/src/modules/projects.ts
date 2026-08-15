import { asc, eq } from 'drizzle-orm';
import { databases, projects, services, type Project } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createProject, projectPatch } from '@ninedeploy/schemas';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound, parseId } from '../lib/errors.js';
import { iso } from '../lib/serialize.js';
import { slugify } from '../lib/slug.js';

function serialize(p: Project, counts?: { services: number; databases: number }) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    serviceCount: counts?.services ?? 0,
    databaseCount: counts?.databases ?? 0,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

/**
 * Project CRUD. Deleting a project only detaches its resources (FK is
 * ON DELETE SET NULL) — services and databases survive, ungrouped.
 */
export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const rows = await app.db.query.projects.findMany({ orderBy: [asc(projects.name)] });
    // Count resource membership in JS: projects are few, and a GROUP BY here
    // would still scan the same rows on SQLite at self-hosted scale.
    const svcRows = await app.db.select({ projectId: services.projectId }).from(services);
    const dbRows = await app.db.select({ projectId: databases.projectId }).from(databases);
    const count = (list: Array<{ projectId: number | null }>) => {
      const m = new Map<number, number>();
      for (const r of list) if (r.projectId != null) m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1);
      return m;
    };
    const svcMap = count(svcRows);
    const dbMap = count(dbRows);
    return rows.map((p) =>
      serialize(p, { services: svcMap.get(p.id) ?? 0, databases: dbMap.get(p.id) ?? 0 }),
    );
  });

  app.post('/', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const input = createProject.parse(req.body);
    const slug = input.slug ?? slugify(input.name);
    const exists = await app.db.query.projects.findFirst({ where: eq(projects.slug, slug) });
    if (exists) throw conflict(`Project slug "${slug}" is already taken`);
    const [row] = await app.db
      .insert(projects)
      .values({ name: input.name, slug, description: input.description })
      .returning();
    if (!row) throw badRequest('Could not create project');
    void audit(app.db, req.user!.id, 'project.create', row.name);
    return serialize(row);
  });

  app.patch('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = projectPatch.parse(req.body);
    const row = await app.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!row) throw notFound('Project not found');
    const [updated] = await app.db
      .update(projects)
      .set({ ...(input.name != null && { name: input.name }), ...(input.description !== undefined && { description: input.description }) })
      .where(eq(projects.id, id))
      .returning();
    if (!updated) throw badRequest('Could not update project');
    void audit(app.db, req.user!.id, 'project.update', updated.name);
    return serialize(updated);
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const row = await app.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!row) throw notFound('Project not found');
    await app.db.delete(projects).where(eq(projects.id, id));
    void audit(app.db, req.user!.id, 'project.delete', row.name);
    return { ok: true };
  });
};
