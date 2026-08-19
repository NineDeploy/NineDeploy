import { and, eq, inArray } from 'drizzle-orm';
import {
  databases,
  projects,
  services,
  workspaceMembers,
  type DB,
  type Database,
  type Project,
  type Service,
} from '@ninedeploy/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, notFound, parseId } from './errors.js';

/**
 * Central authorization choke-point for every resource-scoped route.
 *
 * Background: services were guarded from the start (`services.ownerUserId`),
 * but projects and databases shipped without an access decision — any
 * authenticated user could read, mutate or delete another tenant's rows. This
 * module exists so that "which subject may touch which row" is answered in ONE
 * place, and so a newly added resource has to opt into a rule here rather than
 * silently defaulting to "everyone".
 *
 * Access rules
 * ------------
 *   admin            → every resource (operator-level access, unchanged).
 *   service          → `ownerUserId` must match; NULL owner is admin-only.
 *   project          → caller must be a member of the project's workspace;
 *                      a project with NULL `workspaceId` is admin-only.
 *   database         → `ownerUserId` match, OR membership of the owning
 *                      project's workspace; NULL owner + NULL project is
 *                      admin-only.
 *
 * Not-found vs forbidden: loaders throw 404 (never 403) when a member is
 * denied, so resource ids cannot be enumerated by probing for a status-code
 * difference. `assert*` helpers operate on a row the caller already holds and
 * throw 403, because existence is by then already established.
 */

export interface AuthedUser {
  id: number;
  role: 'admin' | 'member';
}

export type ResourceKind = 'service' | 'project' | 'database';

/** True for operator-level accounts, which bypass per-resource ownership. */
export const isAdmin = (user: AuthedUser): boolean => user.role === 'admin';

// ── workspace membership ───────────────────────────────────────────────────

/** Workspace ids the user belongs to (empty when they belong to none). */
export async function userWorkspaceIds(db: DB, userId: number): Promise<number[]> {
  const rows = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, userId),
  });
  return rows.map((r) => r.workspaceId);
}

/** True when the user may act inside this workspace (admins always may). */
export async function isWorkspaceMember(db: DB, workspaceId: number, user: AuthedUser): Promise<boolean> {
  if (isAdmin(user)) return true;
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)),
  });
  return membership != null;
}

/** Throws 403 unless the user may act inside this workspace. */
export async function assertWorkspaceMember(db: DB, workspaceId: number, user: AuthedUser): Promise<void> {
  if (!(await isWorkspaceMember(db, workspaceId, user))) {
    throw forbidden('You do not have access to this workspace');
  }
}

// ── services ───────────────────────────────────────────────────────────────

/**
 * Resolve a service the user may manage, else 404.
 *
 * Members are matched on `ownerUserId`; a service with a NULL owner (legacy
 * rows predating the column) is admin-only. Deliberately unchanged from the
 * original `serviceAccess.ts` implementation — this is a move, not a rule
 * change, so no member gains access they did not already have.
 */
export async function loadServiceForUser(db: DB, id: number, user: AuthedUser): Promise<Service> {
  const svc = await db.query.services.findFirst({ where: eq(services.id, id) });
  if (!svc) throw notFound('Service not found');
  if (isAdmin(user)) return svc;
  // 404 on both miss and not-owned: members must not be able to probe the
  // existence of other members' services by id.
  if (svc.ownerUserId !== user.id) throw notFound('Service not found');
  return svc;
}

/** Throws 403 unless the user may manage a service row already in memory. */
export function assertCanManageService(svc: Pick<Service, 'ownerUserId'>, user: AuthedUser): void {
  if (isAdmin(user)) return;
  if (svc.ownerUserId === user.id) return;
  throw forbidden('You do not have access to this service');
}

// ── projects ───────────────────────────────────────────────────────────────

/**
 * Resolve a project the user may manage, else 404.
 *
 * Projects carry no owner column; the workspace they belong to is the unit of
 * access. An unscoped project (NULL `workspaceId`) is admin-only rather than
 * world-readable — the permissive reading is what allowed cross-tenant env
 * injection.
 */
export async function loadProjectForUser(db: DB, id: number, user: AuthedUser): Promise<Project> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw notFound('Project not found');
  if (isAdmin(user)) return project;
  if (project.workspaceId == null) throw notFound('Project not found');
  if (!(await isWorkspaceMember(db, project.workspaceId, user))) throw notFound('Project not found');
  return project;
}

/**
 * Drizzle predicate limiting a `projects` query to what the user may see, or
 * `null` when they may see nothing. Admins get `undefined` (no restriction).
 */
export async function projectScopeFilter(db: DB, user: AuthedUser) {
  if (isAdmin(user)) return undefined;
  const ids = await userWorkspaceIds(db, user.id);
  if (ids.length === 0) return null;
  return inArray(projects.workspaceId, ids);
}

// ── databases ──────────────────────────────────────────────────────────────

/**
 * Resolve a managed database the user may manage, else 404.
 *
 * `ownerUserId` is stamped at creation (see the runtime migration in
 * plugins/db.ts). Rows created before that column existed have a NULL owner
 * and fall back to the owning project's workspace; with neither, they are
 * admin-only.
 */
export async function loadDatabaseForUser(db: DB, id: number, user: AuthedUser): Promise<Database> {
  const row = await db.query.databases.findFirst({ where: eq(databases.id, id) });
  if (!row) throw notFound('Database not found');
  if (isAdmin(user)) return row;
  if (row.ownerUserId === user.id) return row;
  if (row.projectId != null) {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, row.projectId) });
    if (project?.workspaceId != null && (await isWorkspaceMember(db, project.workspaceId, user))) {
      return row;
    }
  }
  throw notFound('Database not found');
}

/** Ids of every database the user may see. Admins are unrestricted (`null`). */
export async function visibleDatabaseIds(db: DB, user: AuthedUser): Promise<number[] | null> {
  if (isAdmin(user)) return null;
  const workspaceIds = await userWorkspaceIds(db, user.id);
  const projectIds =
    workspaceIds.length > 0
      ? (await db.query.projects.findMany({ where: inArray(projects.workspaceId, workspaceIds) })).map((p) => p.id)
      : [];
  const rows = await db.query.databases.findMany();
  return rows
    .filter((d) => d.ownerUserId === user.id || (d.projectId != null && projectIds.includes(d.projectId)))
    .map((d) => d.id);
}

// ── generic dispatcher ─────────────────────────────────────────────────────

/**
 * Kind-dispatched loader. Prefer the concrete `load*ForUser` functions where
 * the row type matters; this exists for the `requireAccess` prehandler and for
 * call sites that only need the authorization decision.
 */
export async function requireResourceAccess(
  db: DB,
  kind: ResourceKind,
  id: number,
  user: AuthedUser,
): Promise<Service | Project | Database> {
  switch (kind) {
    case 'service':
      return loadServiceForUser(db, id, user);
    case 'project':
      return loadProjectForUser(db, id, user);
    case 'database':
      return loadDatabaseForUser(db, id, user);
  }
}

/**
 * Route-level prehandler factory: declares the access decision next to the
 * route instead of relying on each handler to remember it.
 *
 *   app.delete('/:id', { preHandler: [requireAccess('database')] }, handler)
 *
 * Runs after `authenticate` (which populates `req.user`).
 */
export function requireAccess(kind: ResourceKind, param = 'id') {
  return async function accessPreHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const raw = (req.params as Record<string, string>)[param];
    if (raw === undefined) throw notFound('Resource not found');
    const db = (req.server as unknown as { db: DB }).db;
    await requireResourceAccess(db, kind, parseId(raw), req.user!);
  };
}
