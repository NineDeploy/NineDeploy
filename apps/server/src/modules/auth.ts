import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { apiTokens, type DB, users, type User } from '@ninedeploy/db';
import type { PublicUser, Register, TokenPair } from '@ninedeploy/schemas';
import { login, passwordChange, refresh, register } from '@ninedeploy/schemas';
import { config } from '../config.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { signAccessToken, signRefreshToken, ttlSeconds, verifyJwt } from '../lib/jwt.js';
import { getSetting } from '../lib/settings.js';

const toUser = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

async function issueTokens(user: User): Promise<TokenPair> {
  // Bake the user's tokenVersion into the JWT so a later bump (logout / role
  // change / password change) invalidates these tokens.
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.id, user.tokenVersion),
    signRefreshToken(user.id, user.tokenVersion),
  ]);
  return { accessToken, refreshToken, expiresIn: ttlSeconds(config.jwt.accessTtl) };
}

/** Count existing users (used to decide first-user-is-admin). */
async function userCount(db: DB): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

/** Create the very first user (admin). Throws if any user already exists. */
export async function createFirstAdmin(db: DB, input: Register) {
  if ((await userCount(db)) > 0) throw conflict('Instance is already initialized');
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, name: input.name ?? null, role: 'admin' })
    .returning();
  if (!user) throw badRequest('Could not create user');
  return { user: toUser(user), tokens: await issueTokens(user) };
}

/** Register a user. The first user becomes admin; everyone else is a member. */
export async function registerAccount(db: DB, input: Register) {
  const isFirst = (await userCount(db)) === 0;
  const passwordHash = await hashPassword(input.password);
  let user: User | undefined;
  try {
    [user] = await db
      .insert(users)
      .values({ email: input.email, passwordHash, name: input.name ?? null, role: isFirst ? 'admin' : 'member' })
      .returning();
  } catch {
    throw badRequest('Email is already registered', 'email_taken');
  }
  if (!user) throw badRequest('Could not create user');
  return { user: toUser(user), tokens: await issueTokens(user) };
}

/** Tighter rate limit for credential-bearing endpoints (brute-force / credential-stuffing defense). */
const AUTH_LIMIT = { max: 20, timeWindow: '1 minute' };

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Public: whether the instance has any users yet (drives first-run setup UI)
  // and whether open registration is currently allowed (drives the register form).
  app.get('/status', async () => ({
    initialized: (await userCount(app.db)) > 0,
    allowRegistration: await getSetting(app.db, 'allow_registration', true),
  }));

  app.post('/register', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    // Open registration can be disabled by an admin (anyone who finds the
    // panel URL could otherwise self-provision a member account). Bootstrap
    // stays possible: when no user exists yet the first registration becomes
    // the admin regardless of the flag (same rule as /setup).
    const noUsers = (await userCount(app.db)) === 0;
    if (!noUsers && !(await getSetting(app.db, 'allow_registration', true))) {
      throw forbidden('Registration is disabled on this instance');
    }
    return registerAccount(app.db, register.parse(req.body));
  });

  app.post('/login', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = login.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw unauthorized('Invalid email or password');
    }
    return { user: toUser(user), tokens: await issueTokens(user) };
  });

  app.post('/refresh', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = refresh.parse(req.body);
    let payload;
    try {
      payload = await verifyJwt(input.refreshToken);
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    if (payload.type !== 'refresh') throw unauthorized('Invalid refresh token');
    const userId = Number(payload.sub);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw unauthorized();
    // Reject refresh tokens minted before the user's tokenVersion was bumped
    // (logout / role change / password change) — otherwise a revoked session
    // could simply mint fresh tokens here.
    if (payload.ver !== undefined && payload.ver !== user.tokenVersion) {
      throw unauthorized('Invalid refresh token');
    }
    return { user: toUser(user), tokens: await issueTokens(user) };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user) throw unauthorized();
    return toUser(user);
  });

  // Logout: bump the user's tokenVersion so every outstanding JWT (access +
  // refresh) for this user is rejected on its next verification. Stateless
  // revocation without a server-side blocklist.
  app.post('/logout', { onRequest: [app.authenticate] }, async (req) => {
    await app.db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, req.user!.id));
    return { ok: true };
  });

  // Self-service password change. Requires the CURRENT password; bumps
  // tokenVersion so every other session of this user is logged out, then
  // issues a fresh token pair for the caller.
  app.post('/password', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = passwordChange.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw unauthorized('Invalid current password');
    }
    const passwordHash = await hashPassword(input.newPassword);
    const [updated] = await app.db
      .update(users)
      .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning();
    if (!updated) throw unauthorized();
    return { user: toUser(updated), tokens: await issueTokens(updated) };
  });

  // ── API tokens (for the CLI / CI) ────────────────────────────────────────
  app.post('/tokens', { onRequest: [app.authenticate] }, async (req) => {
    const name = String((req.body as { name?: string } | null)?.name ?? 'cli').slice(0, 100) || 'cli';
    const raw = randomToken(32);
    const [tok] = await app.db
      .insert(apiTokens)
      .values({ userId: req.user!.id, name, hash: sha256(raw) })
      .returning();
    if (!tok) throw badRequest('Could not create token');
    return { id: tok.id, name: tok.name, token: raw, createdAt: tok.createdAt.toISOString() };
  });

  app.get('/tokens', { onRequest: [app.authenticate] }, async (req) => {
    const rows = await app.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, req.user!.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.delete('/tokens/:id', { onRequest: [app.authenticate] }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await app.db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, req.user!.id)));
    return { ok: true };
  });
};
