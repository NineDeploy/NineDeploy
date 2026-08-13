import { eq } from 'drizzle-orm';
import type { DB } from '@ninedeploy/db';
import { apiTokens } from '@ninedeploy/db';
import type { AuthUser } from '../plugins/auth.js';
import { sha256 } from './crypto.js';
import { verifyJwt } from './jwt.js';

/**
 * Resolve a raw bearer credential to a user. Accepts either a signed JWT access
 * token or an opaque API token. Returns null when the credential is invalid.
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
    return { id: Number(payload.sub) };
  }

  // Opaque API token — compare by sha256 hash.
  const row = await db.query.apiTokens.findFirst({ where: eq(apiTokens.hash, sha256(token)) });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return { id: row.userId };
}
