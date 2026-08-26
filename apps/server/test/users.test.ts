import { describe, expect, it, vi } from 'vitest';
import { userRoutes } from '../src/modules/users.js';
import { asUser, buildTestApp, createFakeDb, userRow } from './helpers.js';

const cryptoMock = vi.hoisted(() => ({
  hashPassword: vi.fn(async () => 'new-hash'),
  randomToken: vi.fn(() => 'r'.repeat(43)),
  sha256: vi.fn(() => 'tok-hash'),
}));
vi.mock('../src/lib/crypto.js', () => cryptoMock);

const admin = () => userRow({ id: 1, isOperator: true });
const member = () => userRow({ id: 1, isOperator: false });

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

  it('forbids non-operator users', async () => {
    const app = await appWith({ findFirst: { users: member() } });
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser({ isOperator: false }) });
    expect(res.statusCode).toBe(403);
  });

  it('lists users with operator and workspaceCount fields', async () => {
    // The fake `findMany` doesn't honour the `where: eq(userId)` filter, so
    // we put the per-user membership rows in a function-style resolver.
    // Without an owner seat the server reports `isOperator: false` for
    // everyone — the goal of this test is to exercise the serialization
    // shape, not the operator derivation (covered by the integration
    // /oidc.test.ts path that creates a real workspace row).
    const app = await appWith({
      findMany: {
        users: [
          admin(),
          userRow({ id: 2, email: 'b@example.com', name: 'B', isOperator: false }),
        ],
        workspaceMembers: () => [],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      { id: 1, email: 'admin@example.com', name: 'Admin', isOperator: false, workspaceCount: 0 },
      { id: 2, email: 'b@example.com', name: 'B', isOperator: false, workspaceCount: 0 },
    ]);
  });

  it('creates a user directly (operator path, e.g. closed registration)', async () => {
    const app = await appWith({
      insert: { users: [userRow({ id: 9, email: 'new@x.dev', isOperator: false })] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'new@x.dev', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 9, email: 'new@x.dev', isOperator: false });
  });

  it('creates a user without a name (optional field)', async () => {
    const app = await appWith({
      insert: { users: [userRow({ id: 10, email: 'noname@x.dev', name: null })] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'noname@x.dev', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('reports not-found when the insert returns nothing', async () => {
    const app = await appWith({ insert: { users: [] } });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'fail@x.dev', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects creating a user with a duplicate email', async () => {
    const app = await appWith({
      findFirst: { users: userRow({ id: 1, email: 'dup@x.dev' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { email: 'dup@x.dev', password: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not delete yourself', async () => {
    const app = await appWith({ findFirst: { users: userRow({ id: 1, isOperator: true }) } });
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(400);
  });

  it('deletes a user via the operator path', async () => {
    const app = await appWith({ findFirst: { users: userRow({ id: 5 }) } });
    const res = await app.inject({ method: 'DELETE', url: '/5', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when deleting a user that vanished mid-check', async () => {
    const app = await appWith({ delete: { users: [] } });
    const res = await app.inject({ method: 'DELETE', url: '/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('resets a user password as operator (hash + tokenVersion bump)', async () => {
    const updated = userRow({ id: 7 });
    const app = await appWith({
      findFirst: { users: updated },
      update: { users: [updated] },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/7/password',
      headers: asUser(),
      payload: { newPassword: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(cryptoMock.hashPassword).toHaveBeenCalledWith('fresh-pass-123');
  });

  it('404s when resetting the password of a missing user', async () => {
    const app = await appWith({ findFirst: { users: undefined }, update: { users: [] } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/999/password',
      headers: asUser(),
      payload: { newPassword: 'fresh-pass-123' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a password reset shorter than 8 chars', async () => {
    const app = await appWith({});
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/password',
      headers: asUser(),
      payload: { newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('mints a one-time reset link for an existing user', async () => {
    const app = await appWith({ findFirst: { users: userRow({ id: 3 }) } });
    const res = await app.inject({ method: 'POST', url: '/3/reset-link', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/\/reset-password\?token=/);
  });

  it('404s when minting a reset link for a missing user', async () => {
    const app = await appWith({ findFirst: { users: undefined } });
    const res = await app.inject({ method: 'POST', url: '/9999/reset-link', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });
});
