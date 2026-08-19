import { and, asc, eq } from 'drizzle-orm';
import { databases, projects, services, type Project } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createProject, projectPatch } from '@ninedeploy/schemas';
import { audit } from '../lib/audit.js';
import { assertWorkspaceMember, loadProjectForUser, projectScopeFilter } from '../lib/resourceAccess.js';
import { badRequest, conflict, parseId } from '../lib/errors.js';
import { iso } from '../lib/serialize.js';
import { slugify } from '../lib/slug.js';

function serialize(p: Project, counts?: { services: number; databases: number }) {
  return {
    id: p.id,
    workspaceId: p.workspaceId ?? null,
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

  app.get('/', async (req) => {
    const query = req.query as { workspaceId?: string };
    const workspaceId = query?.workspaceId;
    const numWorkspaceId = workspaceId ? parseInt(workspaceId, 10) : undefined;
    // The caller-supplied ?workspaceId= narrows the view; it must never widen
    // it, so the membership filter is ANDed on top rather than replaced.
    // `null` means the member belongs to no workspace and can see nothing.
    const scope = await projectScopeFilter(app.db, req.user!);
    if (scope === null) return [];
    const filters = [
      ...(numWorkspaceId ? [eq(projects.workspaceId, numWorkspaceId)] : []),
      ...(scope ? [scope] : []),
    ];
    const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters);
    const rows = await app.db.query.projects.findMany({ where, orderBy: [asc(projects.name)] });
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
    // A project may only be created inside a workspace the caller belongs to —
    // otherwise a member could plant a project (and its shared env) in someone
    // else's workspace.
    if (input.workspaceId != null) await assertWorkspaceMember(app.db, input.workspaceId, req.user!);
    const slug = input.slug ?? slugify(input.name);
    const exists = await app.db.query.projects.findFirst({ where: eq(projects.slug, slug) });
    if (exists) throw conflict(`Project slug "${slug}" is already taken`);
    const [row] = await app.db
      .insert(projects)
      .values({ name: input.name, slug, description: input.description, workspaceId: input.workspaceId ?? null })
      .returning();
    if (!row) throw badRequest('Could not create project');
    void audit(app.db, req.user!.id, 'project.create', row.name);
    return serialize(row);
  });

  app.patch('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = projectPatch.parse(req.body);
    await loadProjectForUser(app.db, id, req.user!);
    // Re-homing a project is a membership change on both ends: the caller must
    // belong to the destination too, or they could move a project they can see
    // into a workspace only they control.
    if (input.workspaceId != null) await assertWorkspaceMember(app.db, input.workspaceId, req.user!);
    // Detaching a project (workspaceId: null) makes it admin-only under the
    // access rules, so only an admin may do it.
    if (input.workspaceId === null && req.user!.role !== 'admin') {
      throw badRequest('Only an admin can detach a project from its workspace');
    }
    const [updated] = await app.db
      .update(projects)
      .set({
        ...(input.name != null && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.workspaceId !== undefined && { workspaceId: input.workspaceId }),
      })
      .where(eq(projects.id, id))
      .returning();
    if (!updated) throw badRequest('Could not update project');
    void audit(app.db, req.user!.id, 'project.update', updated.name);
    return serialize(updated);
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const row = await loadProjectForUser(app.db, id, req.user!);
    await app.db.delete(projects).where(eq(projects.id, id));
    void audit(app.db, req.user!.id, 'project.delete', row.name);
    return { ok: true };
  });
};
