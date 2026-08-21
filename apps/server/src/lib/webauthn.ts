import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture, VerifyAuthenticationResponseOpts, VerifyRegistrationResponseOpts } from '@simplewebauthn/server';
import type { WebauthnCredential } from '@ninedeploy/db';
import { config } from '../config.js';

/**
 * Passkey (WebAuthn) helpers. Relying-party identity derives from the instance's
 * public URL: rpID = hostname (credentials are scoped to it), origin = full URL.
 */
function rpIdentity(): { rpID: string; rpName: string; origin: string } {
  const url = new URL(config.publicUrl);
  return { rpID: url.hostname, rpName: 'NineDeploy', origin: config.publicUrl.replace(/\/$/, '') };
}

/** DB transports (plain strings) → the library's union type. */
const asTransports = (t: string[]): AuthenticatorTransportFuture[] => t as AuthenticatorTransportFuture[];

// ── challenge store ────────────────────────────────────────────────────────
// In-memory with a 5-minute TTL: challenges are single-use and short-lived by
// design; a restart simply aborts in-flight ceremonies (user retries).
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challenges = new Map<string, { value: string; expires: number }>();

function remember(key: string, value: string): void {
  sweep();
  challenges.set(key, { value, expires: Date.now() + CHALLENGE_TTL_MS });
}

function consume(key: string): string | null {
  sweep();
  const entry = challenges.get(key);
  if (!entry) return null;
  challenges.delete(key);
  return entry.value;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of challenges) {
    if (entry.expires < now) challenges.delete(key);
  }
}

// ── registration ───────────────────────────────────────────────────────────
export async function beginRegistration(
  user: { id: number; email: string; name: string | null },
  existing: Pick<WebauthnCredential, 'credentialId' | 'transports'>[],
): Promise<string> {
  const { rpID, rpName } = rpIdentity();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(String(user.id)),
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: asTransports(c.transports) })),
    // 'required' (not 'preferred'): the login ceremony sends an empty
    // allowCredentials list (see beginAuthentication), so a non-discoverable
    // credential would register successfully and then never be offered.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  remember(`reg:${user.id}`, options.challenge);
  return JSON.stringify(options);
}

export async function finishRegistration(
  user: { id: number; email: string; name: string | null },
  existing: Pick<WebauthnCredential, 'credentialId'>[],
  response: unknown,
): Promise<{ credentialId: string; publicKey: string; counter: number; transports: string[] }> {
  const expectedChallenge = consume(`reg:${user.id}`);
  if (!expectedChallenge) throw new Error('No pending registration challenge — start again');
  const { rpID, origin } = rpIdentity();
  const verification = await verifyRegistrationResponse({
    response: response as VerifyRegistrationResponseOpts['response'],
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey verification failed');
  const info = verification.registrationInfo;
  const credentialId = Buffer.from(info.credential.id).toString('base64url');
  if (existing.some((c) => c.credentialId === credentialId)) throw new Error('This passkey is already registered');
  return {
    credentialId,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
  };
}

// ── authentication ─────────────────────────────────────────────────────────
const LOGIN_KEY = 'login';

/**
 * L-5: `allowCredentials` is deliberately EMPTY.
 *
 * The login route is unauthenticated, so filling the allow-list meant handing
 * every `credentialId` registered on the instance to any anonymous caller —
 * a stable per-passkey identifier, and a live count of how many accounts have
 * enrolled one. An empty list is the discoverable-credential ("passkey")
 * flow this route already documents: the authenticator itself offers the user
 * the accounts it holds for this RP, and the server learns which one only
 * from the signed assertion.
 *
 * The cost is that a NON-discoverable credential cannot be offered by the
 * browser, which is why registration now asks for `residentKey: 'required'`.
 */
export async function beginAuthentication(): Promise<string> {
  const { rpID } = rpIdentity();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: [],
  });
  remember(LOGIN_KEY, options.challenge);
  return JSON.stringify(options);
}

export async function finishAuthentication(
  credential: Pick<WebauthnCredential, 'credentialId' | 'publicKey' | 'counter'>,
  response: unknown,
): Promise<number> {
  const expectedChallenge = consume(LOGIN_KEY);
  if (!expectedChallenge) throw new Error('No pending login challenge — start again');
  const { rpID, origin } = rpIdentity();
  const verification = await verifyAuthenticationResponse({
    response: response as VerifyAuthenticationResponseOpts['response'],
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.credentialId,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
      counter: credential.counter,
      transports: [],
    },
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.authenticationInfo) throw new Error('Passkey verification failed');
  return verification.authenticationInfo.newCounter;
}
