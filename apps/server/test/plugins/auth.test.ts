import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { signAccessToken, signRefreshToken } from '../../src/lib/jwt.js';
import { apiTokens } from '@ninedeploy/db';
import { sha256 } from '../../src/lib/crypto.js';

const authPlugin = (await import('../../src/plugins/auth.js')).default;

function makeDb(
  rows: Array<{ userId: number; expiresAt: Date | null } | undefined>,
  user?: { id: number; isOperator?: boolean; tokenVersion?: number },
) {
  const findFirst = vi.fn(async () => (rows.length ? rows[0] : undefined));
  // The operator flag is a column on the user row now, not an inference from
  // workspace seats — see lib/resourceAccess.ts:isOperator.
  const userFindFirst = vi.fn(async () =>
    user ? { tokenVersion: 0, isInstanceOperator: user.isOperator === true, ...user } : undefined,
  );
  const workspaceMembersFindMany = vi.fn(async () =>
    user?.isOperator
      ? [{ workspaceId: 1, userId: user.id, role: 'owner', createdAt: new Date(), updatedAt: new Date() }]
      : [],
  );
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  }));
  return {
    query: {
      apiTokens: { findFirst },
      users: { findFirst: userFindFirst },
      workspaceMembers: { findMany: workspaceMembersFindMany },
    },
    update,
    findFirst,
    set: () => undefined,
  };
}

async function buildApp(db: ReturnType<typeof makeDb>) {
  const app = Fastify();
  app.decorate('db', db as never);
  await app.register(authPlugin);
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => ({ user: req.user }));
  app.delete('/admin', { preHandler: [app.authenticate, app.requireAdmin] }, async () => ({ ok: true }));
  return app;
}

describe('auth plugin', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = await buildApp(makeDb([]));
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 401 for a non-Bearer scheme', async () => {
    const app = await buildApp(makeDb([]));
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Basic abc' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('sets req.user for a valid access JWT and skips the token stamp', async () => {
    const db = makeDb([], { id: 42, isOperator: true });
    const app = await buildApp(db);
    const token = await signAccessToken(42, 0);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 42, isOperator: true, tokenScopes: null } });
    expect(db.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 401 for a refresh JWT', async () => {
    const app = await buildApp(makeDb([]));
    const token = await signRefreshToken(42);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 401 for a malformed JWT', async () => {
    const app = await buildApp(makeDb([]));
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer a.b.c' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('resolves an API token through the db and stamps lastUsedAt', async () => {
    const db = makeDb([{ userId: 7, expiresAt: null }], { id: 7, isOperator: true });
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer api-token-no-dots' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 7, isOperator: true, tokenScopes: null } });
    expect(db.findFirst).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledWith(apiTokens);
    const setFn = db.update.mock.results[0]!.value.set;
    expect(setFn).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
    const whereFn = setFn.mock.results[0]!.value.where;
    expect(whereFn).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(sha256('api-token-no-dots')).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });

  it('returns 401 for an unknown API token', async () => {
    const db = makeDb([]);
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer unknown-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(db.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 401 for an expired API token', async () => {
    const db = makeDb([{ userId: 3, expiresAt: new Date(Date.now() - 1000) }]);
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer expired-token' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('requireAdmin allows an admin through', async () => {
    const db = makeDb([], { id: 1, isOperator: true });
    const app = await buildApp(db);
    const token = await signAccessToken(1, 0);
    const res = await app.inject({ method: 'DELETE', url: '/admin', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('requireOperator and requireAdmin 401 when no user was resolved', async () => {
    // Both guards are documented as running AFTER `authenticate`. Registering
    // them alone proves they fail closed rather than reading `undefined`.
    const app = Fastify({ logger: false });
    app.decorate('db', makeDb([]) as never);
    await app.register(authPlugin);
    app.get('/op', { preHandler: [app.requireOperator] }, async () => ({ ok: true }));
    app.get('/adm', { preHandler: [app.requireAdmin] }, async () => ({ ok: true }));
    expect((await app.inject({ method: 'GET', url: '/op' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/adm' })).statusCode).toBe(401);
    await app.close();
  });

  it('requireAdmin rejects a member with 403', async () => {
    const db = makeDb([], { id: 2, isOperator: false });
    const app = await buildApp(db);
    const token = await signAccessToken(2, 0);
    const res = await app.inject({ method: 'DELETE', url: '/admin', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  /**
   * The escalation §16.1 closed: `owner` in a workspace the caller created
   * themselves must not confer instance-operator rights. This assertion used to
   * live on a second, unused `requireOperator()` prehandler in
   * `lib/resourceAccess.ts`; that helper is gone, so the guarantee is asserted
   * here, on the gate the routes actually use.
   */
  it('rejects a workspace owner who does not carry the instance-operator flag', async () => {
    const db = makeDb([], { id: 3, isOperator: false });
    // The user holds an `owner` seat…
    db.query.workspaceMembers.findMany = vi.fn(async () => [
      { workspaceId: 1, userId: 3, role: 'owner', createdAt: new Date(), updatedAt: new Date() },
    ]);
    const app = await buildApp(db);
    const token = await signAccessToken(3, 0);
    // …and is still not an operator: the flag is a column, never an inference.
    const res = await app.inject({ method: 'DELETE', url: '/admin', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
