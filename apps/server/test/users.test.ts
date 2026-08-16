import { describe, expect, it, vi } from 'vitest';
import { userRoutes } from '../src/modules/users.js';
import { asUser, buildTestApp, createFakeDb, userRow } from './helpers.js';

const cryptoMock = vi.hoisted(() => ({
  hashPassword: vi.fn(async () => 'new-hash'),
  randomToken: vi.fn(() => 'r'.repeat(43)),
  sha256: vi.fn(() => 'tok-hash'),
}));
vi.mock('../src/lib/crypto.js', () => cryptoMock);

const admin = () => userRow({ id: 1, role: 'admin' });
const member = () => userRow({ id: 1, role: 'member' });

async function appWith(fixtures: Record<string, unknown>) {
  const app = await buildTestApp({ db: createFakeDb(fixtures as never) });
  await app.register(userRoutes);
  return app;
}

describe('users routes', () => {
  it('requires authentication', async () => {
    const app = await appWith({});
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(401);
  });

  it('forbids non-admin users', async () => {
    const app = await appWith({ findFirst: { users: member() } });
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(403);
  });

  it('forbids when the acting user is missing', async () => {
    const app = await appWith({});
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(403);
  });

  it('lists users', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      findMany: {
        users: [admin(), userRow({ id: 2, email: 'b@example.com', name: 'B', role: 'member' })],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin' },
      { id: 2, email: 'b@example.com', name: 'B', role: 'member' },
    ]);
  });

  it('creates a user directly (admin path, e.g. closed registration)', async () => {
    // findFirst call 1 = acting admin (guard), call 2 = email uniqueness (miss)
    let findFirstCalls = 0;
    const app = await appWith({
      findFirst: { users: () => (++findFirstCalls === 1 ? admin() : undefined) },
      insert: { users: [userRow({ id: 3, email: 'new@example.com', name: 'New', role: 'member' })] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'new@example.com', password: 'fresh-pass-123', name: 'New', role: 'member' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 3, email: 'new@example.com', name: 'New', role: 'member' });
    expect(cryptoMock.hashPassword).toHaveBeenCalledWith('fresh-pass-123');
  });

  it('creates a user without a name (optional field)', async () => {
    let findFirstCalls = 0;
    const app = await appWith({
      findFirst: { users: () => (++findFirstCalls === 1 ? admin() : undefined) },
      insert: { users: [userRow({ id: 4, email: 'bare@example.com', name: null })] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'bare@example.com', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBeNull();
  });

  it('reports not-found when the insert returns nothing', async () => {
    let findFirstCalls = 0;
    const app = await appWith({
      findFirst: { users: () => (++findFirstCalls === 1 ? admin() : undefined) },
      insert: { users: [] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'ghost@example.com', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects creating a user with a duplicate email', async () => {
    const app = await appWith({ findFirst: { users: admin() } });
    // second findFirst (email check) returns the existing user
    app.db.query.users.findFirst = async () => userRow({ id: 2, email: 'dup@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'dup@example.com', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('email_taken');
  });

  it('rejects an invalid role', async () => {
    const app = await appWith({ findFirst: { users: admin() } });
    const res = await app.inject({
      method: 'PATCH', url: '/2/role', headers: asUser(), payload: { role: 'root' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a role patch without a body', async () => {
    const app = await appWith({ findFirst: { users: admin() } });
    const res = await app.inject({ method: 'PATCH', url: '/2/role', headers: asUser() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('promotes a user to admin', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      update: { users: [userRow({ id: 2, role: 'admin' })] },
    });
    const res = await app.inject({
      method: 'PATCH', url: '/2/role', headers: asUser(), payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 2, role: 'admin' });
  });

  it('demotes a user when other admins remain', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      counts: { users: [{ n: 2 }] },
      update: { users: [userRow({ id: 2, role: 'member' })] },
    });
    const res = await app.inject({
      method: 'PATCH', url: '/2/role', headers: asUser(), payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 2, role: 'member' });
  });

  it('blocks demoting the last admin', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      counts: { users: [{ n: 1 }] },
    });
    const res = await app.inject({
      method: 'PATCH', url: '/2/role', headers: asUser(), payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks demoting when the admin count is unknown', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      counts: { users: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: '/2/role', headers: asUser(), payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the target user is missing', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      counts: { users: [{ n: 2 }] },
      update: { users: [] },
    });
    const res = await app.inject({
      method: 'PATCH', url: '/2/role', headers: asUser(), payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('blocks deleting yourself', async () => {
    const app = await appWith({ findFirst: { users: admin() } });
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser(1) });
    expect(res.statusCode).toBe(400);
  });

  it('blocks deleting the last admin', async () => {
    const app = await appWith({
      findFirst: { users: admin() }, // acting user (id 1) is admin
      counts: { users: [{ n: 0 }] },
    });
    // findFirst must return admin for the acting user AND the target (id 2).
    const db = createFakeDb({
      findFirst: { users: (args?: unknown) => ((args as { where?: unknown } | undefined)?.where ? userRow({ id: 2, role: 'admin' }) : admin()) },
      counts: { users: [{ n: 0 }] },
    });
    const app2 = await buildTestApp({ db });
    await app2.register(userRoutes);
    const res = await app2.inject({ method: 'DELETE', url: '/2', headers: asUser(1) });
    expect(res.statusCode).toBe(400);
    void app;
  });

  it('blocks deleting the last admin when the count row is missing', async () => {
    const db = createFakeDb({
      findFirst: {
        users: (args?: unknown) => ((args as { where?: unknown } | undefined)?.where ? userRow({ id: 2, role: 'admin' }) : admin()),
      },
      counts: { users: [] },
    });
    const app = await buildTestApp({ db });
    await app.register(userRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/2', headers: asUser(1) });
    expect(res.statusCode).toBe(400);
  });

  it('deletes an admin when another admin remains', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      counts: { users: [{ n: 1 }] },
    });
    const res = await app.inject({ method: 'DELETE', url: '/2', headers: asUser(1) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('deletes a member without the admin-count check', async () => {
    const app = await appWith({
      findFirst: {
        // preHandler lookup (acting user, id 1) → admin; target lookup (id 2) → member.
        users: (() => {
          let n = 0;
          return () => (n++ === 0 ? admin() : userRow({ id: 2, role: 'member' }));
        })(),
      },
    });
    const res = await app.inject({ method: 'DELETE', url: '/2', headers: asUser(1) });
    expect(res.statusCode).toBe(200);
  });

  it('resets a user password as admin (hash + tokenVersion bump)', async () => {
    const app = await appWith({
      findFirst: { users: admin() },
      update: { users: [userRow({ id: 2 })] },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/2/password',
      headers: asUser(1),
      payload: { newPassword: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(cryptoMock.hashPassword).toHaveBeenCalledWith('fresh-pass-123');
  });

  it('404s when resetting the password of a missing user', async () => {
    const app = await appWith({ findFirst: { users: admin() }, update: { users: [] } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/99/password',
      headers: asUser(1),
      payload: { newPassword: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a password reset shorter than 8 chars', async () => {
    const app = await appWith({ findFirst: { users: admin() } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/2/password',
      headers: asUser(1),
      payload: { newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  // ── one-time reset links ────────────────────────────────────────────────
  it('mints a one-time reset link for an existing user', async () => {
    const app = await appWith({
      findFirst: { users: userRow({ id: 2, email: 'b@example.com' }) },
      delete: { password_reset_tokens: [{}] },
      insert: { password_reset_tokens: [{}] },
    });
    const res = await app.inject({ method: 'POST', url: '/2/reset-link', headers: asUser(1) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toMatch(/\/reset-password\?token=/);
    expect(body.expiresAt).toBeTruthy();
  });

  it('404s when minting a reset link for a missing user', async () => {
    // First users.findFirst call = the admin preHandler; second = the target.
    let calls = 0;
    const app = await appWith({
      findFirst: {
        users: () => {
          calls += 1;
          return calls === 1 ? userRow({ id: 2, email: 'b@example.com' }) : undefined;
        },
      },
    });
    const res = await app.inject({ method: 'POST', url: '/99/reset-link', headers: asUser(1) });
    expect(res.statusCode).toBe(404);
  });
});
