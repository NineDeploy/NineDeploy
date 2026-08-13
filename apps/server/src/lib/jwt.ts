import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.jwt.secret);

export interface AppJwtPayload extends JWTPayload {
  type: 'access' | 'refresh';
  /** Token-version marker; must match the user's `tokenVersion` or the token is rejected. */
  ver?: number;
}

function sign(userId: number, type: 'access' | 'refresh', ttl: string, ver?: number): Promise<string> {
  const claims: Record<string, unknown> = { type };
  if (ver !== undefined) claims['ver'] = ver;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret);
}

export const signAccessToken = (userId: number, ver?: number) => sign(userId, 'access', config.jwt.accessTtl, ver);
export const signRefreshToken = (userId: number, ver?: number) => sign(userId, 'refresh', config.jwt.refreshTtl, ver);

export async function verifyJwt(token: string): Promise<AppJwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as AppJwtPayload;
}

/** Parse a human TTL ("15m", "7d", "2h", "30s") into seconds (fallback 900). */
export function ttlSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(ttl);
  if (!match) return 900;
  const n = Number(match[1]);
  const mult = match[2] === 's' ? 1 : match[2] === 'm' ? 60 : match[2] === 'h' ? 3600 : 86400;
  return n * mult;
}
