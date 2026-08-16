import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { signAccessToken, signRefreshToken } from '../../src/lib/jwt.js';
import { apiTokens } from '@ninedeploy/db';
import { sha256 } from '../../src/lib/crypto.js';

const authPlugin = (await import('../../src/plugins/auth.js')).default;

function makeDb(
  rows: Array<{ userId: number; expiresAt: Date | null } | undefined>,
  user?: { id: number; role: 'admin' | 'member'; tokenVersion?: number },
) {
  const findFirst = vi.fn(async () => (rows.length ? rows[0] : undefined));
  const userFindFirst = vi.fn(async () => (user ? { tokenVersion: 0, ...user } : undefined));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  }));
  return {
    query: { apiTokens: { findFirst }, users: { findFirst: userFindFirst } },
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
    const db = makeDb([], { id: 42, role: 'admin' });
    const app = await buildApp(db);
    const token = await signAccessToken(42, 0);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 42, role: 'admin' } });
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
    const db = makeDb([{ userId: 7, expiresAt: null }], { id: 7, role: 'admin' });
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer api-token-no-dots' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 7, role: 'admin' } });
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
    const db = makeDb([], { id: 1, role: 'admin' });
    const app = await buildApp(db);
    const token = await signAccessToken(1, 0);
    const res = await app.inject({ method: 'DELETE', url: '/admin', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('requireAdmin rejects a member with 403', async () => {
    const db = makeDb([], { id: 2, role: 'member' });
    const app = await buildApp(db);
    const token = await signAccessToken(2, 0);
    const res = await app.inject({ method: 'DELETE', url: '/admin', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
