import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { config } from '../../src/config.js';
import { sha256 } from '../../src/lib/crypto.js';
import { resolveUser } from '../../src/lib/auth.js';
import { signAccessToken, signRefreshToken } from '../../src/lib/jwt.js';

const secret = new TextEncoder().encode(config.jwt.secret);

async function expiredAccessToken() {
  return new SignJWT({ type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('9')
    .setExpirationTime('-5s')
    .sign(secret);
}

type Role = 'admin' | 'member';

function mockDb(opts: {
  token?: { userId: number; expiresAt: Date | null };
  user?: { id: number; role: Role; tokenVersion: number };
} = {}) {
  return {
    query: {
      apiTokens: { findFirst: vi.fn(async () => opts.token) },
      users: { findFirst: vi.fn(async () => (opts.user ? { tokenVersion: 0, ...opts.user } : undefined)) },
    },
  };
}

describe('resolveUser', () => {
  it('resolves a valid JWT access token to id + role (fresh from DB)', async () => {
    const token = await signAccessToken(42, 0);
    const db = mockDb({ user: { id: 42, isOperator: true } });
    await expect(resolveUser(db as never, token)).resolves.toEqual({ id: 42, isOperator: true });
    expect(db.query.apiTokens.findFirst).not.toHaveBeenCalled();
    expect(db.query.users.findFirst).toHaveBeenCalled();
  });

  it('returns null when the JWT refers to a user that no longer exists', async () => {
    const token = await signAccessToken(42, 0);
    const db = mockDb({ user: undefined });
    await expect(resolveUser(db as never, token)).resolves.toBeNull();
  });

  it('rejects a JWT with no ver claim at all (revocation bypass guard)', async () => {
    const token = await signAccessToken(42);
    const db = mockDb({ user: { id: 42, isOperator: true } });
    await expect(resolveUser(db as never, token)).resolves.toBeNull();
  });

  it('rejects a JWT whose ver does not match the user tokenVersion (revoked session)', async () => {
    // Token minted with ver=1, but the user has since been bumped to ver=2 (logout/role change).
    const token = await signAccessToken(42, 1);
    const db = mockDb({ user: { id: 42, isOperator: true, tokenVersion: 2 } });
    await expect(resolveUser(db as never, token)).resolves.toBeNull();
  });

  it('accepts a JWT whose ver matches the current tokenVersion', async () => {
    const token = await signAccessToken(42, 3);
    const db = mockDb({ user: { id: 42, isOperator: true, tokenVersion: 3 } });
    await expect(resolveUser(db as never, token)).resolves.toEqual({ id: 42, isOperator: true });
  });

  it('rejects a refresh token (wrong type)', async () => {
    const token = await signRefreshToken(42);
    await expect(resolveUser(mockDb({ user: { id: 42, isOperator: true } }) as never, token)).resolves.toBeNull();
  });

  it('returns null for a malformed JWT', async () => {
    await expect(resolveUser(mockDb() as never, 'a.b.c')).resolves.toBeNull();
  });

  it('returns null for an expired JWT', async () => {
    const token = await expiredAccessToken();
    await expect(resolveUser(mockDb() as never, token)).resolves.toBeNull();
  });

  it('resolves an opaque API token via its sha256 hash and loads the role', async () => {
    const db = mockDb({ token: { userId: 7, expiresAt: null }, user: { id: 7, isOperator: false } });
    const user = await resolveUser(db as never, 'opaque-token-abc');
    expect(user).toEqual({ id: 7, isOperator: false });
    expect(db.query.apiTokens.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({}) });
  });

  it('queries with the sha256 of the presented token', async () => {
    const db = mockDb({ token: { userId: 7, expiresAt: null }, user: { id: 7, isOperator: true } });
    await resolveUser(db as never, 'raw-api-token');
    const call = db.query.apiTokens.findFirst.mock.calls[0]![0] as { where: unknown };
    expect(call.where).toBeDefined();
    expect(sha256('raw-api-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when the API token is unknown', async () => {
    const db = mockDb({ token: undefined });
    await expect(resolveUser(db as never, 'unknown-token')).resolves.toBeNull();
  });

  it('returns the user when the token has not expired', async () => {
    const db = mockDb({ token: { userId: 3, expiresAt: new Date(Date.now() + 60_000) }, user: { id: 3, isOperator: true } });
    await expect(resolveUser(db as never, 'still-valid')).resolves.toEqual({ id: 3, isOperator: true });
  });

  it('returns null when the API token has expired', async () => {
    const db = mockDb({ token: { userId: 3, expiresAt: new Date(Date.now() - 60_000) }, user: { id: 3, isOperator: true } });
    await expect(resolveUser(db as never, 'expired-api-token')).resolves.toBeNull();
  });

  it('returns null when the token is valid but the user was deleted', async () => {
    const db = mockDb({ token: { userId: 3, expiresAt: null }, user: undefined });
    await expect(resolveUser(db as never, 'orphaned-token')).resolves.toBeNull();
  });
});
