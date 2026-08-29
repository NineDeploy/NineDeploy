import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Minimal OIDC client — Sprint 5, Gap G-22.
 *
 * Discovery + JWKS fetch + ID-token verification using only
 * `node:crypto` + `fetch`. No new npm dependency.
 *
 * The shape is intentionally narrow: an operator's typical config
 * supplies an issuer URL, a client id, a client secret and a
 * redirect URI. The helper returns the verified `id_token` claims;
 * the HTTP module is responsible for redirecting the user to the
 * authorize endpoint, holding the `state` + `nonce` cookies, and
 * exchanging the authorization code at the token endpoint.
 */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
}

export interface OidcClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  email?: string;
  name?: string;
  preferred_username?: string;
  [extra: string]: unknown;
}

const DEFAULT_SCOPES = ['openid', 'email', 'profile'];

const textEncoder = new TextEncoder();

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}

export async function discover(config: OidcConfig): Promise<OidcDiscovery> {
  const url = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) for ${url}`);
  return (await res.json()) as OidcDiscovery;
}

export function buildAuthorizeUrl(discovery: OidcDiscovery, config: OidcConfig, state: string, nonce: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: (config.scopes ?? DEFAULT_SCOPES).join(' '),
    state,
    nonce,
  });
  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

export interface TokenResponse {
  id_token: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function exchangeCode(
  discovery: OidcDiscovery,
  config: OidcConfig,
  code: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OIDC token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
}

interface Jwks {
  keys: Jwk[];
}

const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

async function fetchJwks(jwksUri: string): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(jwksUri, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status}) for ${jwksUri}`);
  const jwks = (await res.json()) as Jwks;
  jwksCache.set(jwksUri, { fetchedAt: Date.now(), keys: jwks.keys });
  return jwks.keys;
}

function findKey(keys: Jwk[], kid: string | undefined): Jwk {
  if (kid) {
    const found = keys.find((k) => k.kid === kid);
    if (found) return found;
  }
  // Fall back to the first RSA key — most OIDC providers ship only
  // one signing key and never include a `kid` claim.
  const rsa = keys.find((k) => k.kty === 'RSA');
  if (rsa) return rsa;
  throw new Error('No usable JWK in JWKS response');
}

function verifyRs256(input: string, signature: string, jwk: Jwk): boolean {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new Error('JWK is not an RSA public key');
  }
  const data = textEncoder.encode(input);
  const sig = base64UrlDecode(signature);
  const { createVerify } = require('node:crypto') as typeof import('node:crypto');
  // Build the DER-encoded SubjectPublicKeyInfo manually so we do
  // not depend on `KeyObject.fromJwk` (Node 19+). The shape is a
  // standard RSA public key.
  const n = base64UrlDecode(jwk.n);
  const e = base64UrlDecode(jwk.e);
  // ASN.1 INTEGER tag + length + content. RSAPublicKey is:
  //   SEQUENCE { INTEGER n, INTEGER e }
  function asn1Int(buf: Buffer): Buffer {
    // Strip leading zero so the INTEGER is positive.
    let i = 0;
    while (i < buf.length && buf[i] === 0) i++;
    let body = buf.subarray(i);
    if (body[0] === undefined || (body[0]! & 0x80) !== 0) {
      body = Buffer.concat([Buffer.from([0]), body]);
    }
    return Buffer.concat([Buffer.from([0x02, body.length]), body]);
  }
  const inner = Buffer.concat([asn1Int(n), asn1Int(e)]);
  const seq = Buffer.concat([Buffer.from([0x30, inner.length]), inner]);
  // Wrap in SubjectPublicKeyInfo with rsaEncryption OID.
  const rsaEncryptionOid = Buffer.from([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  ]);
  const nullByte = Buffer.from([0x05, 0x00]);
  const algId = Buffer.concat([Buffer.from([0x30]), Buffer.from([rsaEncryptionOid.length + nullByte.length]), rsaEncryptionOid, nullByte]);
  const bitString = Buffer.concat([Buffer.from([0x03, seq.length + 1, 0x00]), seq]);
  const spki = Buffer.concat([Buffer.from([0x30]), Buffer.from([algId.length + bitString.length]), algId, bitString]);
  // The SubjectPublicKeyInfo is the binary content of an X.509
  // SubjectPublicKeyInfo. `createPublicKey` accepts a KeyObject
  // built from a SPKI `Buffer`.
  const { createPublicKey } = require('node:crypto') as typeof import('node:crypto');
  const key = createPublicKey({
    key: spki,
    type: 'spki',
    format: 'der',
  });
  return createVerify('RSA-SHA256').update(data).verify(key, sig);
}

export async function verifyIdToken(
  discovery: OidcDiscovery,
  config: OidcConfig,
  idToken: string,
  expectedNonce: string,
): Promise<OidcClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('ID token is not a JWS compact serialization');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string; kid?: string; typ?: string };
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported ID token alg "${header.alg ?? 'missing'}"`);
  }
  const keys = await fetchJwks(discovery.jwks_uri);
  const key = findKey(keys, header.kid);
  const input = `${headerB64}.${payloadB64}`;
  if (!verifyRs256(input, signatureB64, key)) {
    throw new Error('ID token signature does not verify');
  }
  const claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as OidcClaims;

  // Mandatory claim checks
  if (claims.iss !== config.issuer) {
    throw new Error(`ID token issuer "${claims.iss}" does not match configured issuer`);
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(config.clientId)) {
    throw new Error(`ID token audience does not include client id "${config.clientId}"`);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
    throw new Error('ID token is expired');
  }
  if (typeof claims.nonce !== 'string' || claims.nonce !== expectedNonce) {
    throw new Error('ID token nonce does not match the one stored on the login flow');
  }
  return claims;
}

export function generateOpaqueToken(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function hmacSha256(secret: string, payload: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(payload).digest());
}
