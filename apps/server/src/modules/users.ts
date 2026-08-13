import { and, count, eq, ne } from 'drizzle-orm';
import { users } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

const num = (v: string) => Number(v);

function serialize(u: typeof users.$inferSelect) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** User management (admin only). Mounted under /users. */
export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // Admin guard.
  app.addHook('preHandler', async (req) => {
    const u = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!u || u.role !== 'admin') throw forbidden('Admin access required');
  });

  app.get('/', async () => {
    const rows = await app.db.query.users.findMany({ orderBy: (u, { asc }) => [asc(u.id)] });
    return rows.map(serialize);
  });

  app.patch('/:id/role', async (req) => {
    const id = num((req.params as { id: string }).id);
    const { role } = (req.body ?? {}) as { role?: string };
    if (role !== 'admin' && role !== 'member') throw badRequest('Invalid role');

    // Prevent demoting the last admin.
    if (role === 'member') {
      const [row] = await app.db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
      if ((row?.n ?? 0) <= 1) throw badRequest('Cannot demote the last admin');
    }

    const [updated] = await app.db.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!updated) throw notFound('User not found');
    return serialize(updated);
  });

  app.delete('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    if (id === req.user!.id) throw badRequest('Cannot delete yourself');

    // Prevent deleting the last admin.
    const target = await app.db.query.users.findFirst({ where: eq(users.id, id) });
    if (target?.role === 'admin') {
      const [row] = await app.db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), ne(users.id, id)));
      if ((row?.n ?? 0) === 0) throw badRequest('Cannot delete the last admin');
    }

    await app.db.delete(users).where(eq(users.id, id));
    return { ok: true };
  });
};
