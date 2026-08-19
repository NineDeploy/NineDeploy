import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { apiTokens, type DB, oidcProviders, type OidcProvider, sessions as sessionsTable, users, webauthnCredentials, type User } from '@ninedeploy/db';
import type { PublicUser, Register } from '@ninedeploy/schemas';
import { forgotPassword, login, oidcProviderCreate, oidcProviderUpdate, type OidcProviderEntry, type OidcPublicProvider, passkeyLoginVerify, passkeyRegisterVerify, passwordChange, passwordResetWithToken, refresh, register, twoFactorCode, twoFactorDisable, twoFactorSetup } from '@ninedeploy/schemas';
import { config } from '../config.js';
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, parseId, unauthorized } from '../lib/errors.js';
import { verifyJwt, type AppJwtPayload } from '../lib/jwt.js';
import { isLocked, recordFailure, recordSuccess } from '../lib/loginLockout.js';
import { consumeResetToken, issueResetToken } from '../lib/passwordReset.js';
import { sendSystemEmail } from '../lib/notifier.js';
import { generateSecret, otpauthUri, verifyTotp } from '../lib/totp.js';
import { audit } from '../lib/audit.js';
import { getSetting } from '../lib/settings.js';
import { findLiveSession, issueSessionTokens, refreshSessionTokens, revokeAllSessions } from '../lib/sessions.js';
import { beginAuthentication, beginRegistration, finishAuthentication, finishRegistration } from '../lib/webauthn.js';
import { exchangeGitHubCode, exchangeOidcCode, fetchOidcConfiguration, fetchOidcUserInfo, generateOAuthState, verifyOAuthState } from '../lib/oauth.js';
import { ensureDefaultWorkspace } from './workspaces.js';
import { iso } from '../lib/serialize.js';

const toUser = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role });

function serializeOidc(p: OidcProvider): OidcProviderEntry {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    issuerUrl: p.issuerUrl,
    clientId: p.clientId,
    scopes: p.scopes,
    enabled: Boolean(p.enabled),
    autoEnroll: Boolean(p.autoEnroll),
    defaultRole: p.defaultRole as 'admin' | 'member',
    createdAt: iso(p.createdAt) as string,
    updatedAt: iso(p.updatedAt) as string,
  };
}

/** Count existing users (used to decide first-user-is-admin). */
async function userCount(db: Pick<DB, 'select'>): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

/**
 * Create the very first user (admin). Count + insert run inside a single
 * transaction so two concurrent bootstrap requests cannot both become the
 * first admin — the loser sees the committed row and gets a 409.
 */
export async function createFirstAdmin(db: DB, input: Register) {
  return db.transaction(async (tx) => {
    if ((await userCount(tx)) > 0) throw conflict('Instance is already initialized');
    const passwordHash = await hashPassword(input.password);
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash, name: input.name ?? null, role: 'admin' })
      .returning();
    if (!user) throw badRequest('Could not create user');
    return { user: toUser(user), tokens: await issueSessionTokens(tx, user) };
  });
}

/** Register a user. The first user becomes admin; everyone else is a member. */
export async function registerAccount(db: DB, input: Register) {
  // Same transactional guard as the bootstrap: the count-then-insert race
  // between two simultaneous first registrations must not mint two admins.
  return db.transaction(async (tx) => {
    const isFirst = (await userCount(tx)) === 0;
    const passwordHash = await hashPassword(input.password);
    let user: User | undefined;
    try {
      [user] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, name: input.name ?? null, role: isFirst ? 'admin' : 'member' })
        .returning();
    } catch {
      throw badRequest('Email is already registered', 'email_taken');
    }
    if (!user) throw badRequest('Could not create user');
    return { user: toUser(user), tokens: await issueSessionTokens(tx, user) };
  });
}

/** Tighter rate limit for credential-bearing endpoints (brute-force / credential-stuffing defense). */
const AUTH_LIMIT = { max: 20, timeWindow: '1 minute' };
/** Reset requests are cheap to spam (each mints a token + maybe an email). */
const FORGOT_LIMIT = { max: 5, timeWindow: '1 minute' };

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Public: whether the instance has any users yet (drives first-run setup UI)
  // and whether open registration is currently allowed (drives the register form).
  app.get('/status', async () => ({
    initialized: (await userCount(app.db)) > 0,
    allowRegistration: await getSetting(app.db, 'allow_registration', true),
  }));

  app.post('/register', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    // Open registration can be disabled by an admin (anyone who finds the
    // panel URL could otherwise self-provision a member account). Bootstrap
    // stays possible: when no user exists yet the first registration becomes
    // the admin regardless of the flag (same rule as /setup).
    const noUsers = (await userCount(app.db)) === 0;
    if (!noUsers && !(await getSetting(app.db, 'allow_registration', true))) {
      throw forbidden('Registration is disabled on this instance');
    }
    return registerAccount(app.db, register.parse(req.body));
  });

  app.post('/login', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = login.parse(req.body);
    // Per-account lockout (complements the per-IP rate limit): the response is
    // deliberately identical to a wrong password so the lock state isn't a probe.
    if (isLocked(input.email)) throw unauthorized('Invalid email or password');
    const user = await app.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      const locked = recordFailure(input.email);
      if (locked) void audit(app.db, null, 'auth.lockout', input.email);
      throw unauthorized('Invalid email or password');
    }
    // 2FA: a missing code gets a distinct (but non-enumerating) error; a wrong
    // code counts as a failed login for lockout purposes.
    if (user.totpEnabled && user.totpSecretEncrypted) {
      if (!input.totpCode) throw unauthorized('Two-factor code required', 'totp_required');
      if (!verifyTotp(decrypt(user.totpSecretEncrypted), input.totpCode)) {
        const locked = recordFailure(input.email);
        if (locked) void audit(app.db, null, 'auth.lockout', input.email);
        throw unauthorized('Invalid two-factor code', 'totp_invalid');
      }
    }
    recordSuccess(input.email);
    void audit(app.db, user.id, 'auth.login', user.email, undefined, { ip: req.ip, userAgent: req.headers['user-agent'] });
    return {
      user: toUser(user),
      tokens: await issueSessionTokens(app.db, user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }),
    };
  });

  // ── Passkeys (WebAuthn) ──────────────────────────────────────────────────
  // Registration ceremony: options (challenge) → browser prompt → verify.
  app.post('/passkey/register/options', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user) throw unauthorized();
    const existing = await app.db
      .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, user.id));
    return { options: await beginRegistration(user, existing) };
  });

  app.post('/passkey/register/verify', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = passkeyRegisterVerify.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user) throw unauthorized();
    const existing = await app.db
      .select({ credentialId: webauthnCredentials.credentialId })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, user.id));
    let stored: { credentialId: string; publicKey: string; counter: number; transports: string[] };
    try {
      stored = await finishRegistration(user, existing, input.response);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Passkey verification failed');
    }
    const [row] = await app.db
      .insert(webauthnCredentials)
      .values({ userId: user.id, ...stored, name: input.name })
      .returning();
    if (!row) throw badRequest('Could not store passkey');
    void audit(app.db, user.id, 'auth.passkey_added', user.email, { name: input.name });
    return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
  });

  app.get('/passkey', { onRequest: [app.authenticate] }, async (req) => {
    const rows = await app.db
      .select({ id: webauthnCredentials.id, name: webauthnCredentials.name, createdAt: webauthnCredentials.createdAt })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, req.user!.id));
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString() }));
  });

  app.delete('/passkey/:id', { onRequest: [app.authenticate] }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await app.db
      .delete(webauthnCredentials)
      .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, req.user!.id)));
    void audit(app.db, req.user!.id, 'auth.passkey_removed', undefined, { id });
    return { ok: true };
  });

  // Authentication ceremony (public — the credential IS the proof of identity;
  // discoverable credentials let the user pick an account in the browser prompt).
  app.post('/passkey/login/options', { config: { rateLimit: AUTH_LIMIT } }, async () => {
    const credentials = await app.db
      .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
      .from(webauthnCredentials);
    return { options: await beginAuthentication(credentials) };
  });

  app.post('/passkey/login/verify', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = passkeyLoginVerify.parse(req.body);
    const id = String((input.response as { id?: unknown }).id ?? '');
    if (!id) throw unauthorized('Invalid passkey response');
    const cred = await app.db.query.webauthnCredentials.findFirst({
      where: eq(webauthnCredentials.credentialId, id),
    });
    if (!cred) throw unauthorized('Unknown passkey');
    let newCounter: number;
    try {
      newCounter = await finishAuthentication(cred, input.response);
    } catch (err) {
      throw unauthorized(err instanceof Error ? err.message : 'Passkey verification failed');
    }
    await app.db
      .update(webauthnCredentials)
      .set({ counter: newCounter })
      .where(eq(webauthnCredentials.id, cred.id));
    const user = await app.db.query.users.findFirst({ where: eq(users.id, cred.userId) });
    if (!user) throw unauthorized();
    void audit(app.db, user.id, 'auth.passkey_login', user.email, undefined, { ip: req.ip, userAgent: req.headers['user-agent'] });
    return {
      user: toUser(user),
      tokens: await issueSessionTokens(app.db, user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }),
    };
  });

  // ── Session management ───────────────────────────────────────────────────
  app.get('/sessions', { onRequest: [app.authenticate] }, async (req) => {
    const rows = await app.db.query.sessions.findMany({ where: eq(sessionsTable.userId, req.user!.id) });
    // The current session is flagged by matching the access token's jti
    // claim (both token types carry it) — failures simply flag no row.
    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    let currentJti: string | undefined;
    try {
      currentJti = (await verifyJwt(bearer)).jti;
    } catch {
      currentJti = undefined;
    }
    return rows
      .filter((r) => !r.revokedAt && r.expiresAt.getTime() > Date.now())
      .sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0))
      .map((r) => ({
        id: r.id,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        current: currentJti === r.jti,
      }));
  });

  app.delete('/sessions/:id', { onRequest: [app.authenticate] }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await app.db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessionsTable.id, id), eq(sessionsTable.userId, req.user!.id)));
    void audit(app.db, req.user!.id, 'auth.session_revoked', undefined, { id });
    return { ok: true };
  });

  // ── Two-factor (TOTP) setup / enable / disable ───────────────────────────
  // Setup generates (or regenerates) a pending secret + otpauth URI; enable
  // verifies a code from the user's authenticator and flips the flag; disable
  // requires the password AND a valid code, then bumps tokenVersion.
  app.post('/2fa/setup', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user) throw unauthorized();
    // Regenerating the secret also flips totpEnabled off — when 2FA is active
    // this must not be reachable with a bare token: require the password.
    if (user.totpEnabled) {
      const input = twoFactorSetup.parse(req.body ?? {});
      if (!(await verifyPassword(user.passwordHash, input.password))) throw unauthorized('Invalid password');
    }
    const secret = generateSecret();
    await app.db
      .update(users)
      .set({ totpSecretEncrypted: encrypt(secret), totpEnabled: false })
      .where(eq(users.id, user.id));
    void audit(app.db, user.id, 'auth.2fa_setup', user.email);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  });

  app.post('/2fa/enable', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = twoFactorCode.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user?.totpSecretEncrypted) throw badRequest('Start 2FA setup first');
    if (!verifyTotp(decrypt(user.totpSecretEncrypted), input.code)) throw badRequest('Invalid two-factor code');
    await app.db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
    void audit(app.db, user.id, 'auth.2fa_enabled', user.email);
    return { ok: true, totpEnabled: true };
  });

  app.post('/2fa/disable', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = twoFactorDisable.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user) throw unauthorized();
    if (!(await verifyPassword(user.passwordHash, input.password))) throw unauthorized('Invalid password');
    if (user.totpEnabled && user.totpSecretEncrypted) {
      if (!verifyTotp(decrypt(user.totpSecretEncrypted), input.code)) {
        throw badRequest('Invalid two-factor code');
      }
    }
    // Bump tokenVersion: every outstanding session is re-issued without 2FA claims pending.
    await app.db
      .update(users)
      .set({ totpEnabled: false, totpSecretEncrypted: null, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, user.id));
    await revokeAllSessions(app.db, user.id);
    void audit(app.db, user.id, 'auth.2fa_disabled', user.email);
    return { ok: true, totpEnabled: false };
  });

  // Forgot password: always answers the same way (no user enumeration). When
  // the account exists, a single-use 30-minute reset token is minted and — if
  // an email notification channel is configured — the reset link is emailed.
  // Without SMTP the token is still consumable via an admin-issued link.
  app.post('/forgot-password', { config: { rateLimit: FORGOT_LIMIT } }, async (req) => {
    const input = forgotPassword.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (user) {
      const { token } = await issueResetToken(app.db, user, req.ip);
      const link = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
      // Best-effort delivery — failures never change the response.
      await sendSystemEmail(
        app.db,
        'NineDeploy password reset',
        `A password reset was requested for ${input.email}.\n\nOpen this link within 30 minutes to set a new password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
      ).catch(() => false);
      void audit(app.db, user.id, 'auth.forgot_password', user.email);
    }
    return { ok: true };
  });

  // Complete a reset: consume the single-use token, set the new password, and
  // revoke every outstanding session (tokenVersion bump).
  app.post('/reset-password', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = passwordResetWithToken.parse(req.body);
    const user = await consumeResetToken(app.db, input.token, input.newPassword);
    await revokeAllSessions(app.db, user.id);
    void audit(app.db, user.id, 'auth.reset_password', user.email);
    return { ok: true };
  });

  app.post('/refresh', { config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = refresh.parse(req.body);
    let payload: AppJwtPayload;
    try {
      payload = await verifyJwt(input.refreshToken);
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    if (payload.type !== 'refresh' || !payload.jti) throw unauthorized('Invalid refresh token');
    const session = await findLiveSession(app.db, payload.jti);
    if (!session) throw unauthorized('Invalid refresh token');
    const userId = Number(payload.sub);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw unauthorized();
    // Reject refresh tokens minted before the user's tokenVersion was bumped
    // (logout / role change / password change) — otherwise a revoked session
    // could simply mint fresh tokens here. ver is mandatory.
    if (payload.ver === undefined || payload.ver !== user.tokenVersion) {
      throw unauthorized('Invalid refresh token');
    }
    if (session.userId !== user.id) throw unauthorized('Invalid refresh token');
    return { user: toUser(user), tokens: await refreshSessionTokens(app.db, user, payload.jti) };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user) throw unauthorized();
    return toUser(user);
  });

  // Logout: bump the user's tokenVersion so every outstanding JWT (access +
  // refresh) for this user is rejected on its next verification, and mark the
  // backing session rows revoked so they disappear from the session list.
  app.post('/logout', { onRequest: [app.authenticate] }, async (req) => {
    await app.db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, req.user!.id));
    await revokeAllSessions(app.db, req.user!.id);
    return { ok: true };
  });

  // Self-service password change. Requires the CURRENT password; bumps
  // tokenVersion so every other session of this user is logged out, then
  // issues a fresh token pair for the caller.
  app.post('/password', { onRequest: [app.authenticate], config: { rateLimit: AUTH_LIMIT } }, async (req) => {
    const input = passwordChange.parse(req.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw unauthorized('Invalid current password');
    }
    const passwordHash = await hashPassword(input.newPassword);
    const [updated] = await app.db
      .update(users)
      .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, user.id))
      .returning();
    if (!updated) throw unauthorized();
    await revokeAllSessions(app.db, user.id);
    return { user: toUser(updated), tokens: await issueSessionTokens(app.db, updated, { ip: req.ip, userAgent: req.headers['user-agent'] }) };
  });

  // ── API tokens (for the CLI / CI) ────────────────────────────────────────
  app.post('/tokens', { onRequest: [app.authenticate] }, async (req) => {
    const name = String((req.body as { name?: string } | null)?.name ?? 'cli').slice(0, 100) || 'cli';
    const raw = randomToken(32);
    const [tok] = await app.db
      .insert(apiTokens)
      .values({ userId: req.user!.id, name, hash: sha256(raw) })
      .returning();
    if (!tok) throw badRequest('Could not create token');
    return { id: tok.id, name: tok.name, token: raw, createdAt: tok.createdAt.toISOString() };
  });

  app.get('/tokens', { onRequest: [app.authenticate] }, async (req) => {
    const rows = await app.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, req.user!.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.delete('/tokens/:id', { onRequest: [app.authenticate] }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    await app.db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, req.user!.id)));
    return { ok: true };
  });

  // ── OIDC & OAuth2 SSO Provider Management (Admin) ─────────────────────────
  app.get('/oidc/providers/public', async (): Promise<OidcPublicProvider[]> => {
    const rows = await app.db.query.oidcProviders.findMany({
      where: eq(oidcProviders.enabled, true),
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      authUrl: `/v1/auth/oidc/${p.slug}/login`,
    }));
  });

  app.get('/oidc/providers', { onRequest: [app.authenticate, app.requireAdmin] }, async (): Promise<OidcProviderEntry[]> => {
    const rows = await app.db.query.oidcProviders.findMany();
    return rows.map(serializeOidc);
  });

  app.post('/oidc/providers', { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const input = oidcProviderCreate.parse(req.body);
    const existing = await app.db.query.oidcProviders.findFirst({ where: eq(oidcProviders.slug, input.slug) });
    if (existing) throw conflict(`Provider with slug "${input.slug}" already exists`);

    const clientSecretEncrypted = encrypt(input.clientSecret);
    const [created] = await app.db
      .insert(oidcProviders)
      .values({
        name: input.name,
        slug: input.slug,
        issuerUrl: input.issuerUrl ?? null,
        clientId: input.clientId,
        clientSecretEncrypted,
        scopes: input.scopes,
        enabled: input.enabled,
        autoEnroll: input.autoEnroll,
        defaultRole: input.defaultRole,
      })
      .returning();

    void audit(app.db, req.user!.id, 'oidc_provider.create', created!.name);
    return serializeOidc(created!);
  });

  app.patch('/oidc/providers/:id', { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = oidcProviderUpdate.parse(req.body);

    const existing = await app.db.query.oidcProviders.findFirst({ where: eq(oidcProviders.id, id) });
    if (!existing) throw notFound('OIDC provider not found');

    const [updated] = await app.db
      .update(oidcProviders)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.issuerUrl !== undefined && { issuerUrl: input.issuerUrl ?? null }),
        ...(input.clientId !== undefined && { clientId: input.clientId }),
        ...(input.clientSecret !== undefined && { clientSecretEncrypted: encrypt(input.clientSecret) }),
        ...(input.scopes !== undefined && { scopes: input.scopes }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.autoEnroll !== undefined && { autoEnroll: input.autoEnroll }),
        ...(input.defaultRole !== undefined && { defaultRole: input.defaultRole }),
      })
      .where(eq(oidcProviders.id, id))
      .returning();

    void audit(app.db, req.user!.id, 'oidc_provider.update', updated!.name);
    return serializeOidc(updated!);
  });

  app.delete('/oidc/providers/:id', { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const existing = await app.db.query.oidcProviders.findFirst({ where: eq(oidcProviders.id, id) });
    if (!existing) throw notFound('OIDC provider not found');

    await app.db.delete(oidcProviders).where(eq(oidcProviders.id, id));
    void audit(app.db, req.user!.id, 'oidc_provider.delete', existing.name);
    return { ok: true };
  });

  // ── OIDC & OAuth2 Login Initiation ─────────────────────────────────────────
  app.get('/oidc/:slug/login', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const query = req.query as { returnTo?: string; json?: string };
    const returnTo = query?.returnTo;
    const json = query?.json;

    const provider = await app.db.query.oidcProviders.findFirst({
      where: and(eq(oidcProviders.slug, slug), eq(oidcProviders.enabled, true)),
    });
    if (!provider) throw notFound(`OAuth2/OIDC provider "${slug}" not found or disabled`);

    const state = generateOAuthState(slug, returnTo);
    const origin = `${req.protocol}://${req.hostname}`;
    const redirectUri = `${origin}/v1/auth/oidc/${slug}/callback`;

    let authUrl: string;
    if (slug === 'github' || (!provider.issuerUrl && slug.includes('github'))) {
      const params = new URLSearchParams({
        client_id: provider.clientId,
        redirect_uri: redirectUri,
        scope: provider.scopes,
        state,
      });
      authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    } else {
      if (!provider.issuerUrl) throw badRequest(`Provider "${slug}" is missing an issuer URL`);
      const oidcConfig = await fetchOidcConfiguration(provider.issuerUrl);
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: provider.clientId,
        redirect_uri: redirectUri,
        scope: provider.scopes,
        state,
      });
      authUrl = `${oidcConfig.authorization_endpoint}?${params.toString()}`;
    }

    if (json === 'true' || json === '1') {
      return { authUrl };
    }
    return reply.redirect(authUrl);
  });

  // ── OIDC & OAuth2 Login Callback ───────────────────────────────────────────
  const handleOidcCallback = async (req: any, reply: any, isPost: boolean) => {
    const { slug } = req.params as { slug: string };
    const query = (isPost ? req.body : req.query) as { code?: string; state?: string; error?: string; error_description?: string };

    if (query.error) {
      throw unauthorized(query.error_description || query.error);
    }
    if (!query.code || !query.state) {
      throw badRequest('Missing OAuth code or state parameter');
    }

    const stateData = verifyOAuthState(query.state);
    if (!stateData || stateData.slug !== slug) {
      throw unauthorized('Invalid or expired OAuth state parameter');
    }

    const provider = await app.db.query.oidcProviders.findFirst({
      where: and(eq(oidcProviders.slug, slug), eq(oidcProviders.enabled, true)),
    });
    if (!provider) throw notFound(`OAuth2/OIDC provider "${slug}" not found or disabled`);

    const clientSecret = decrypt(provider.clientSecretEncrypted);
    const origin = `${req.protocol}://${req.hostname}`;
    const redirectUri = `${origin}/v1/auth/oidc/${slug}/callback`;

    let userInfo: { sub: string; email: string; emailVerified: boolean; name?: string | null };

    if (slug === 'github' || (!provider.issuerUrl && slug.includes('github'))) {
      userInfo = await exchangeGitHubCode(provider.clientId, clientSecret, query.code, redirectUri);
    } else {
      if (!provider.issuerUrl) throw badRequest(`Provider "${slug}" is missing an issuer URL`);
      const oidcConfig = await fetchOidcConfiguration(provider.issuerUrl);
      const tokens = await exchangeOidcCode(oidcConfig.token_endpoint, provider.clientId, clientSecret, query.code, redirectUri);
      const userinfoEndpoint = oidcConfig.userinfo_endpoint || `${provider.issuerUrl.replace(/\/+$/, '')}/userinfo`;
      userInfo = await fetchOidcUserInfo(userinfoEndpoint, tokens.access_token);
    }

    let user = await app.db.query.users.findFirst({ where: eq(users.email, userInfo.email) });
    if (user && userInfo.emailVerified === false) {
      // Never link an unverified (e.g. synthetic-namespace) SSO identity to a
      // pre-existing local account: an attacker who pre-registered the address
      // would otherwise silently share the real SSO user's account. Refusing
      // (fail closed) turns a takeover into, at worst, a denial of service.
      throw forbidden('SSO email address is not verified; refusing to link an existing account');
    }
    if (!user) {
      if (!provider.autoEnroll) {
        throw forbidden('Auto-enrollment is disabled for this SSO provider');
      }
      const randomPassword = randomToken(32);
      const passwordHash = await hashPassword(randomPassword);
      const isFirst = (await userCount(app.db)) === 0;
      const role = isFirst ? 'admin' : provider.defaultRole;

      const [created] = await app.db
        .insert(users)
        .values({
          email: userInfo.email,
          passwordHash,
          name: userInfo.name ?? null,
          role,
        })
        .returning();

      user = created!;
    }

    // Ensure default workspace exists
    await ensureDefaultWorkspace(app.db, user);

    const tokens = await issueSessionTokens(app.db, user, { ip: req.ip, userAgent: req.headers['user-agent'] });
    void audit(app.db, user.id, 'auth.sso_login', `${provider.name} (${userInfo.email})`, undefined, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (isPost) {
      return { user: toUser(user), tokens };
    }

    // Redirect browser with tokens in hash fragment. The returnTo target must
    // stay same-origin: a protocol-relative "//evil.com" (or "/\evil.com",
    // which browsers normalize the same way) passes a naive startsWith('/')
    // check and would carry the tokens in the fragment to the attacker's site.
    const rawReturnTo = stateData.returnTo;
    const returnToSafe =
      typeof rawReturnTo === 'string' &&
      rawReturnTo.startsWith('/') &&
      !rawReturnTo.startsWith('//') &&
      !rawReturnTo.startsWith('/\\');
    const returnTo = returnToSafe ? rawReturnTo : '/';
    return reply.redirect(`${returnTo}#access_token=${tokens.accessToken}&refresh_token=${tokens.refreshToken}`);
  };

  app.get('/oidc/:slug/callback', async (req, reply) => handleOidcCallback(req, reply, false));
  app.post('/oidc/:slug/callback', async (req, reply) => handleOidcCallback(req, reply, true));
};
