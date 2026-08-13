import { eq } from 'drizzle-orm';
import type { DB } from '@ninedeploy/db';
import { apiTokens, users } from '@ninedeploy/db';
import type { AuthUser } from '../plugins/auth.js';
import { sha256 } from './crypto.js';
import { verifyJwt } from './jwt.js';

/** Load a user's id + role + tokenVersion, or null if the account no longer exists. */
async function loadUser(db: DB, userId: number): Promise<(AuthUser & { tokenVersion: number }) | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;
  return { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
}

/**
 * Resolve a raw bearer credential to a user (id + role). Accepts either a signed
 * JWT access token or an opaque API token. Returns null when the credential is
 * invalid, the underlying user no longer exists, or the token was issued before
 * the user's `tokenVersion` was bumped (logout / role change / password change
 * → all outstanding JWTs for that user are invalidated).
 *
 * The role is fetched fresh from the DB on every call (rather than trusted from
 * the JWT) so a role change takes effect on the next request, not the next
 * access-token refresh.
 *
 * Shared by the HTTP `authenticate` pre-handler and the WebSocket log stream
 * (which cannot easily set Authorization headers).
 */
export async function resolveUser(db: DB, token: string): Promise<AuthUser | null> {
  // JWT access token (three dot-separated segments).
  if (token.split('.').length === 3) {
    let payload;
    try {
      payload = await verifyJwt(token);
    } catch {
      return null;
    }
    if (payload.type !== 'access') return null;
    const user = await loadUser(db, Number(payload.sub));
    if (!user) return null;
    // Reject tokens minted before the current tokenVersion (revoked sessions).
    if (payload.ver !== undefined && payload.ver !== user.tokenVersion) return null;
    return { id: user.id, role: user.role };
  }

  // Opaque API token — compare by sha256 hash. Revoked by row deletion.
  const row = await db.query.apiTokens.findFirst({ where: eq(apiTokens.hash, sha256(token)) });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  const user = await loadUser(db, row.userId);
  return user ? { id: user.id, role: user.role } : null;
}
