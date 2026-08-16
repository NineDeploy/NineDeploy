import { and, count, eq, ne, sql } from 'drizzle-orm';
import { audit } from "../lib/audit.js";
import { users } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { passwordReset, rolePatch, userCreate } from '@ninedeploy/schemas';
import { badRequest, forbidden, notFound, parseId } from '../lib/errors.js';
import { hashPassword } from '../lib/crypto.js';
import { issueResetToken } from '../lib/passwordReset.js';
import { config } from '../config.js';

function serialize(u: typeof users.$inferSelect) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** User management (admin only). Mounted under /users. */
export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // Admin guard.
  app.addHook('preHandler', async (req) => {
    const u = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (u?.role !== 'admin') throw forbidden('Admin access required');
  });

  app.get('/', async () => {
    const rows = await app.db.query.users.findMany({ orderBy: (u, { asc }) => [asc(u.id)] });
    return rows.map(serialize);
  });

  // Direct user creation — the admin path for teams with open registration
  // disabled (otherwise /v1/auth/register is the self-service route).
  app.post('/', async (req) => {
    const input = userCreate.parse(req.body);
    const existing = await app.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (existing) throw badRequest('Email is already registered', 'email_taken');
    const [created] = await app.db
      .insert(users)
      .values({
        email: input.email,
        name: input.name ?? null,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      })
      .returning();
    if (!created) throw notFound('Could not create user');
    void audit(app.db, req.user!.id, 'user.create', `${input.email} (${input.role})`);
    return serialize(created);
  });

  app.patch('/:id/role', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const { role } = rolePatch.parse(req.body);

    // Prevent demoting the last admin.
    if (role === 'member') {
      const [row] = await app.db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
      if ((row?.n ?? 0) <= 1) throw badRequest('Cannot demote the last admin');
    }

    const [updated] = await app.db
      .update(users)
      // Bump tokenVersion so the role change takes effect immediately and the
      // user's outstanding sessions are re-issued with the new role.
      .set({ role, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw notFound('User not found');
    void audit(app.db, req.user!.id, 'user.role', `${String(id)} → ${role}`);
    return serialize(updated);
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    if (id === req.user!.id) throw badRequest('Cannot delete yourself');

    // Prevent deleting the last admin.
    const target = await app.db.query.users.findFirst({ where: eq(users.id, id) });
    if (target?.role === 'admin') {
      const [row] = await app.db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), ne(users.id, id)));
      if ((row?.n ?? 0) === 0) throw badRequest('Cannot delete the last admin');
    }

    await app.db.delete(users).where(eq(users.id, id));
    void audit(app.db, req.user!.id, 'user.delete', String(id));
    return { ok: true };
  });

  // Admin-initiated password reset: sets a new password and bumps tokenVersion
  // so the target user's sessions (including stolen ones) are all revoked.
  app.patch('/:id/password', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = passwordReset.parse(req.body);
    const passwordHash = await hashPassword(input.newPassword);
    const [updated] = await app.db
      .update(users)
      .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning();
    if (!updated) throw notFound('User not found');
    void audit(app.db, req.user!.id, 'user.password', `reset for #${id}`);
    return { ok: true };
  });

  // Admin-issued one-time reset link: mints a 30-minute single-use token and
  // returns the raw link exactly once (webhook-secret pattern). For instances
  // without an email channel the admin hands the link to the user directly.
  app.post('/:id/reset-link', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const target = await app.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!target) throw notFound('User not found');
    const { token, expiresAt } = await issueResetToken(app.db, target, `admin:${req.user!.id}`);
    void audit(app.db, req.user!.id, 'user.reset_link', target.email);
    return {
      url: `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
    };
  });
};
