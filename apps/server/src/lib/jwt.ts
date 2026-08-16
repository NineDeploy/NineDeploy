import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.jwt.secret);

export interface AppJwtPayload extends JWTPayload {
  type: 'access' | 'refresh';
  /** Token-version marker; must match the user's `tokenVersion` or the token is rejected. */
  ver?: number;
  /** Refresh-token session id — must reference a live row in `sessions`. */
  jti?: string;
}

function sign(
  userId: number,
  type: 'access' | 'refresh',
  ttl: string,
  ver?: number,
  jti?: string,
): Promise<string> {
  const claims: Record<string, unknown> = { type };
  if (ver !== undefined) claims['ver'] = ver;
  if (jti !== undefined) claims['jti'] = jti;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret);
}

export const signAccessToken = (userId: number, ver?: number, jti?: string) =>
  sign(userId, 'access', config.jwt.accessTtl, ver, jti);
export const signRefreshToken = (userId: number, ver?: number, jti?: string) =>
  sign(userId, 'refresh', config.jwt.refreshTtl, ver, jti);

export async function verifyJwt(token: string): Promise<AppJwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as AppJwtPayload;
}

const TTL_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Convert a human TTL ("15m", "7d", "2h", "30s") to seconds (fallback 900). */
export function ttlSeconds(ttl: string): number {
  const unit = TTL_UNITS[ttl.slice(-1)];
  const amount = Number(ttl.slice(0, -1));
  if (!unit || !Number.isFinite(amount) || amount <= 0) return 900;
  return Math.floor(amount) * unit;
}
