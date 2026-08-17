import { eq } from 'drizzle-orm';
import { services, type DB, type Service } from '@ninedeploy/db';
import { forbidden, notFound } from './errors.js';

export interface AuthedUser {
  id: number;
  role: 'admin' | 'member';
}

/**
 * Resolve a service by id, then check the requesting user may manage it.
 *
 * Rules:
 *   - admins can manage any service (operator-level access, matches the
 *     documented RBAC story);
 *   - the service owner (`ownerUserId`) can manage their own services;
 *   - services with NULL `ownerUserId` (e.g. legacy data, or a service
 *     created before the column was added) are admin-only;
 *   - everyone else is denied with 403.
 *
 * The DB read is conditional on the role: admins fetch by id alone (a
 * missing service still 404s, not 403, so the existence check is consistent
 * for both roles). Members fetch by `(id, ownerUserId)` so a non-owned
 * service id is indistinguishable from a missing one in the response
 * surface (404, not 403) — no enumeration of other members' services.
 */
export async function loadServiceForUser(
  db: DB,
  id: number,
  user: AuthedUser,
): Promise<Service> {
  if (user.role === 'admin') {
    const svc = await db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    return svc;
  }
  const svc = await db.query.services.findFirst({
    where: eq(services.id, id),
  });
  if (!svc || svc.ownerUserId !== user.id) {
    // 404 on both miss and not-owned: members must not be able to
    // probe the existence of other members' services by id.
    throw notFound('Service not found');
  }
  return svc;
}

/**
 * Throws 403 unless the user may manage this service. Use after a route
 * has loaded the service (e.g. for actions that operate on a row already
 * in memory).
 */
export function assertCanManageService(svc: Pick<Service, 'ownerUserId'>, user: AuthedUser): void {
  if (user.role === 'admin') return;
  if (svc.ownerUserId === user.id) return;
  throw forbidden('You do not have access to this service');
}
