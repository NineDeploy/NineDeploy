import { describe, expect, it, vi } from 'vitest';
import { authRoutes, createFirstAdmin, registerAccount } from '../src/modules/auth.js';
import { asUser, buildTestApp, createFakeDb, tokenRow, userRow } from './helpers.js';

const cryptoMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(async () => 'hashed'),
  verifyPassword: vi.fn(async () => true),
  randomToken: vi.fn(() => 'raw-token'),
  sha256: vi.fn(() => 'tok-hash'),
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}));

const jwtMocks = vi.hoisted(() => ({
  signAccessToken: vi.fn(async () => 'access-token'),
  signRefreshToken: vi.fn(async () => 'refresh-token'),
  verifyJwt: vi.fn(async () => ({ type: 'refresh', sub: '1' })),
  ttlSeconds: vi.fn(() => 900),
}));

vi.mock('../src/lib/crypto.js', () => cryptoMocks);
vi.mock('../src/lib/jwt.js', () => jwtMocks);

const validRegister = { email: 'new@example.com', password: 'password123' };

describe('auth module helpers', () => {
  it('createFirstAdmin succeeds when no users exist', async () => {
    const db = createFakeDb({
      counts: { users: [{ n: 0 }] },
      insert: { users: [userRow({ id: 1, email: 'new@example.com' })] },
    });
    const result = await createFirstAdmin(db, validRegister as never);
    expect(result.user).toMatchObject({ id: 1, email: 'new@example.com', role: 'admin' });
    expect(result.tokens).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 });
  });

  it('createFirstAdmin conflicts when users already exist', async () => {
    const db = createFakeDb({ counts: { users: [{ n: 1 }] } });
    await expect(createFirstAdmin(db, validRegister as never)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('createFirstAdmin fails when the insert returns no row', async () => {
    const db = createFakeDb({ counts: { users: [{ n: 0 }] }, insert: { users: [] } });
    await expect(createFirstAdmin(db, validRegister as never)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('registerAccount makes the first user an admin', async () => {
    const db = createFakeDb({
      counts: { users: [{ n: 0 }] },
      insert: { users: [userRow({ id: 1, email: 'new@example.com', role: 'admin' })] },
    });
    const result = await registerAccount(db, validRegister as never);
    expect(result.user.role).toBe('admin');
  });

  it('registerAccount makes subsequent users members', async () => {
    const db = createFakeDb({
      counts: { users: [{ n: 2 }] },
      insert: { users: [userRow({ id: 3, email: 'new@example.com', role: 'member' })] },
    });
    const result = await registerAccount(db, validRegister as never);
    expect(result.user.role).toBe('member');
  });

  it('registerAccount reports duplicate emails', async () => {
    const db = createFakeDb({
      counts: { users: [{ n: 2 }] },
      insert: { users: () => { throw new Error('UNIQUE'); } },
    });
    await expect(registerAccount(db, validRegister as never)).rejects.toMatchObject({
      statusCode: 400,
      code: 'email_taken',
    });
  });

  it('registerAccount fails when the insert returns no row', async () => {
    const db = createFakeDb({ counts: { users: [{ n: 2 }] }, insert: { users: [] } });
    await expect(registerAccount(db, validRegister as never)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('auth routes', () => {
  it('reports the initialization status', async () => {
    const app = await buildTestApp({ db: createFakeDb({ counts: { users: [{ n: 0 }] } }) });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ initialized: false, allowRegistration: true });
  });

  it('reports initialized when users exist', async () => {
    const app = await buildTestApp({ db: createFakeDb({ counts: { users: [{ n: 3 }] } }) });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.json()).toEqual({ initialized: true, allowRegistration: true });
  });

  it('treats a missing count row as zero users', async () => {
    const app = await buildTestApp({ db: createFakeDb({ counts: {} }) });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.json()).toEqual({ initialized: false, allowRegistration: true });
  });

  it('registers a user', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        counts: { users: [{ n: 1 }] },
        insert: { users: [userRow({ id: 2, email: 'new@example.com', role: 'member' })] },
      }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/register', payload: validRegister });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: 2, email: 'new@example.com', role: 'member' });
    expect(res.json().tokens.expiresIn).toBe(900);
  });

  it('blocks registration when open registration is disabled and users exist', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        counts: { users: [{ n: 2 }] },
        findFirst: { settings: { key: 'allow_registration', value: false } },
      }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/register', payload: validRegister });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('Registration is disabled');
  });

  it('still allows bootstrap registration when disabled but no user exists', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        counts: { users: [{ n: 0 }] },
        findFirst: { settings: { key: 'allow_registration', value: false } },
        insert: { users: [userRow({ id: 1, email: 'new@example.com', role: 'admin' })] },
      }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/register', payload: validRegister });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('admin');
  });

  it('exposes allowRegistration on the public status endpoint', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        counts: { users: [{ n: 1 }] },
        findFirst: { settings: { key: 'allow_registration', value: false } },
      }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.json()).toEqual({ initialized: true, allowRegistration: false });
  });

  it('rejects an invalid register payload', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/register', payload: { email: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('logs in with valid credentials', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1, passwordHash: 'hashed' }) } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'admin@example.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(1);
  });

  it('rejects a wrong password', async () => {
    cryptoMocks.verifyPassword.mockResolvedValueOnce(false);
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1 }) } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'admin@example.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login for an unknown user', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'ghost@example.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refreshes tokens with a valid refresh token', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1 }) } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/refresh',
      payload: { refreshToken: 'valid-refresh' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens.accessToken).toBe('access-token');
  });

  it('rejects a refresh token whose ver no longer matches the user tokenVersion (revoked session)', async () => {
    // Token minted at ver 0, but the user has since been bumped to ver 1 (logout/role change).
    jwtMocks.verifyJwt.mockResolvedValueOnce({ type: 'refresh', sub: '1', ver: 0 });
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1, tokenVersion: 1 }) } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/refresh',
      payload: { refreshToken: 'stale-refresh' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid refresh token', async () => {
    jwtMocks.verifyJwt.mockRejectedValueOnce(new Error('expired'));
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/refresh', payload: { refreshToken: 'bad' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid refresh token');
  });

  it('rejects a non-refresh token type', async () => {
    jwtMocks.verifyJwt.mockResolvedValueOnce({ type: 'access', sub: '1' } as never);
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/refresh', payload: { refreshToken: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects refresh for a missing user', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/refresh', payload: { refreshToken: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current user from /me', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1 }) } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/me', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin' });
  });

  it('returns 401 from /me when the user is gone', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/me', headers: asUser() });
    expect(res.statusCode).toBe(401);
  });

  it('logs out by bumping the user tokenVersion', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/logout', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('requires auth for /logout', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/logout' });
    expect(res.statusCode).toBe(401);
  });

  it('changes the password, bumps tokenVersion and issues fresh tokens', async () => {
    // Current password verifies; update returns the bumped user.
    cryptoMocks.verifyPassword.mockResolvedValueOnce(true);
    const db = createFakeDb({
      findFirst: { users: userRow({ id: 1, tokenVersion: 3 }) },
      update: { users: [userRow({ id: 1, tokenVersion: 4 })] },
    });
    const app = await buildTestApp({ db });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/password',
      headers: asUser(),
      payload: { currentPassword: 'old-pass-123', newPassword: 'new-pass-456' },
    });
    expect(res.statusCode).toBe(200);
    expect(cryptoMocks.verifyPassword).toHaveBeenCalledWith('hash', 'old-pass-123');
    expect(cryptoMocks.hashPassword).toHaveBeenCalledWith('new-pass-456');
    const body = res.json();
    expect(body.user.id).toBe(1);
    expect(body.tokens.accessToken).toBe('access-token');
  });

  it('rejects a password change with a wrong current password', async () => {
    cryptoMocks.verifyPassword.mockResolvedValueOnce(false);
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1 }) } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/password',
      headers: asUser(),
      payload: { currentPassword: 'wrong', newPassword: 'new-pass-456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain('current password');
  });

  it('returns 401 when the password update returns no row (user vanished)', async () => {
    cryptoMocks.verifyPassword.mockResolvedValueOnce(true);
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { users: userRow({ id: 1 }) }, update: { users: [] } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/password',
      headers: asUser(),
      payload: { currentPassword: 'old-pass-123', newPassword: 'new-pass-456' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a too-short new password (validation)', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/password',
      headers: asUser(),
      payload: { currentPassword: 'old-pass-123', newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('creates an API token with a custom name', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { api_tokens: [tokenRow({ id: 5, name: 'ci' })] } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/tokens',
      headers: asUser(),
      payload: { name: 'ci' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 5, name: 'ci', token: 'raw-token', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('creates an API token with the default name when none is given', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { api_tokens: [tokenRow({ id: 5, name: 'cli' })] } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/tokens', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('cli');
  });

  it('falls back to the default name for an empty name', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { api_tokens: [tokenRow({ id: 5, name: 'cli' })] } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/tokens', headers: asUser(), payload: { name: '' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('cli');
  });

  it('truncates very long token names', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { api_tokens: [tokenRow({ id: 5, name: 'x'.repeat(100) })] } }),
    });
    await app.register(authRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/tokens',
      headers: asUser(),
      payload: { name: 'x'.repeat(200) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name.length).toBe(100);
  });

  it('returns 400 when the token insert fails', async () => {
    const app = await buildTestApp({ db: createFakeDb({ insert: { api_tokens: [] } }) });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'POST', url: '/tokens', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('lists API tokens with optional lastUsedAt', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          api_tokens: [
            tokenRow({ id: 1, name: 'a', lastUsedAt: new Date('2026-01-02T00:00:00Z') }),
            tokenRow({ id: 2, name: 'b', lastUsedAt: null }),
          ],
        },
      }),
    });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url: '/tokens', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 1, name: 'a', lastUsedAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, name: 'b', lastUsedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('deletes an API token', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/tokens/3', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('requires auth for /me and token routes', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(authRoutes);
    const me = await app.inject({ method: 'GET', url: '/me' });
    expect(me.statusCode).toBe(401);
    const list = await app.inject({ method: 'GET', url: '/tokens' });
    expect(list.statusCode).toBe(401);
  });
});
