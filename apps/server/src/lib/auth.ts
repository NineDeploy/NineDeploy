import { eq } from 'drizzle-orm';
import type { DB } from '@ninedeploy/db';
import { apiTokens, users } from '@ninedeploy/db';
import type { AuthUser } from '../plugins/auth.js';
import { sha256 } from './crypto.js';
import { verifyJwt, type AppJwtPayload } from './jwt.js';

/**
 * Resolve a raw bearer credential to a user (id only) + the instance-operator
 * flag read from `users.is_instance_operator`.
 *
 * The legacy global `users.role` column is gone, so the JWT no longer carries
 * a role and the DB no longer has one. The `isOperator` flag is computed fresh
 * on every call, so granting or revoking it takes effect on the next request —
 * not the next access-token refresh. It is deliberately NOT derived from
 * workspace membership (that inference let any member self-promote by creating
 * a workspace); see `lib/resourceAccess.ts`.
 *
 * The user is rejected when:
 *   • the credential is invalid (signature, expiry, format)
 *   • the underlying user no longer exists
 *   • the token was issued before the user's `tokenVersion` was bumped
 *     (logout / password change → all outstanding JWTs for that user are
 *     invalidated)
 *
 * Shared by the HTTP `authenticate` pre-handler and the WebSocket log stream
 * (which cannot easily set Authorization headers).
 */
export async function resolveUser(db: DB, token: string): Promise<AuthUser | null> {
  // JWT access token (three dot-separated segments).
  if (token.split('.').length === 3) {
    let payload: AppJwtPayload;
    try {
      payload = await verifyJwt(token);
    } catch {
      return null;
    }
    if (payload.type !== 'access') return null;
    const baseUser = await loadBaseUser(db, Number(payload.sub));
    if (!baseUser) return null;
    // Reject tokens minted before the current tokenVersion (revoked sessions).
    // ver is mandatory: a token without it skips revocation entirely.
    if (payload.ver === undefined || payload.ver !== baseUser.tokenVersion) return null;
    const operator = baseUser.isInstanceOperator || baseUser.role === 'admin';
    // Interactive sessions are never scope-restricted; scopes are an
    // API-token concept.
    return { id: baseUser.id, isOperator: operator, tokenScopes: null };
  }

  // Opaque API token — compare by sha256 hash. Revoked by row deletion.
  const row = await db.query.apiTokens.findFirst({ where: eq(apiTokens.hash, sha256(token)) });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  const baseUser = await loadBaseUser(db, row.userId);
  if (!baseUser) return null;
  const operator = baseUser.isInstanceOperator || baseUser.role === 'admin';
  // Scopes ride along so the auth plugin can narrow the request (it has the
  // HTTP method; this function does not). An empty list means unrestricted —
  // see `apiTokenScope` in @ninedeploy/schemas for why.
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  return { id: baseUser.id, isOperator: operator, tokenScopes: scopes.length > 0 ? scopes : null };
}

interface LoadedUser {
  id: number;
  tokenVersion: number;
  /**
   * The legacy `users.role` column is gone from the live schema, but the
   * shape is preserved on the loaded row so test fixtures / pre-migration
   * rows that still ship a `role` field can act as a back-compat operator
   * marker. The real flag is `users.is_instance_operator`, read below.
   */
  role?: 'admin' | 'member';
  /** `users.is_instance_operator` — the authoritative operator flag. */
  isInstanceOperator: boolean;
}

async function loadBaseUser(db: DB, userId: number): Promise<LoadedUser | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;
  const out: LoadedUser = {
    id: user.id,
    tokenVersion: user.tokenVersion,
    isInstanceOperator: user.isInstanceOperator === true,
  };
  const legacy = (user as { role?: 'admin' | 'member' }).role;
  if (legacy === 'admin' || legacy === 'member') out.role = legacy;
  return out;
}
