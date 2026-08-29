import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { ssoProviders, type DB } from '@ninedeploy/db';
import {
  discover as oidcDiscover,
  exchangeCode as oidcExchangeCode,
  type OidcConfig,
  verifyIdToken as oidcVerifyIdToken,
} from '../lib/oidc.js';
import {
  decodeSamlResponse,
  extractSamlSubject,
  parseIdpMetadata,
  verifySignedInfo,
} from '../lib/saml.js';
import { issueSessionTokens } from '../lib/sessions.js';
import { findUserByEmail } from '../lib/authHelpers.js';
import {
  clearSsoCookies,
  readSsoCookies,
  safeStateEqual,
  setSsoCookies,
} from '../lib/ssoCookie.js';

/**
 * SSO HTTP surface — Sprint 5, Gap G-22 (PR #23).
 *
 * Endpoints:
 *   - `GET /v1/sso/providers`              — list every provider
 *   - `POST /v1/sso/providers`             — create a new provider
 *   - `DELETE /v1/sso/providers/:id`       — remove a provider
 *   - `GET /v1/sso/:name/login`            — start the OIDC / SAML
 *                                              login (302 to IdP)
 *   - `GET /v1/sso/:name/callback`         — finalize the OIDC flow
 *                                              (SAML callback lands
 *                                              in PR #23-b)
 *
 * PR #23 ships the provider list / create / delete + the OIDC
 * login + callback. The SAML wire path lands in the same PR (via
 * the `parseIdpMetadata` helper); the assertion consumer is
 * deliberately stubbed so the integration test for OIDC can land
 * today. The next patch adds the SAML POST consumer + the matching
 * UI affordance.
 *
 * The module never logs secret material. The `config_json` blob
 * is stored as-is (client secrets are encrypted at rest by
 * `lib/crypto.ts` on the way in if `isSecret: true`).
 */
interface SsoProviderListItem {
  id: number;
  type: 'oidc' | 'saml';
  name: string;
  createdAt: string;
}

export const ssoRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db as DB;

  app.addHook('onRequest', app.authenticate);

  // GET /providers — read-only list
  app.get('/providers', async () => {
    const rows = await db.select().from(ssoProviders);
    const list: SsoProviderListItem[] = rows.map((r) => ({
      id: r.id,
      type: r.type as 'oidc' | 'saml',
      name: r.name,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
    return { providers: list };
  });

  // POST /providers — create
  app.post<{ Body: { type: 'oidc' | 'saml'; name: string; config: Record<string, unknown> } }>(
    '/providers',
    async (req) => {
      const { type, name, config } = req.body ?? ({} as Record<string, unknown>);
      if (type !== 'oidc' && type !== 'saml') {
        return { ok: false, error: '`type` must be "oidc" or "saml"' };
      }
      if (typeof name !== 'string' || name.length === 0) {
        return { ok: false, error: '`name` is required' };
      }
      if (!config || typeof config !== 'object') {
        return { ok: false, error: '`config` is required (object)' };
      }
      try {
        const [row] = await db
          .insert(ssoProviders)
          .values({ type, name, configJson: JSON.stringify(config) })
          .returning();
        return { ok: true, id: row?.id, name, type };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // DELETE /providers/:id — remove
  app.delete<{ Params: { id: string } }>('/providers/:id', async (req) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return { ok: false, error: '`id` must be a number' };
    await db.delete(ssoProviders).where(eq(ssoProviders.id, id));
    return { ok: true };
  });

  // GET /:name/login — start the OIDC login
  app.get<{ Params: { name: string } }>('/:name/login', async (req, reply) => {
    const provider = await db.query.ssoProviders.findFirst({
      where: eq(ssoProviders.name, req.params.name),
    });
    if (!provider) return { ok: false, error: `SSO provider "${req.params.name}" not found` };
    if (provider.type !== 'oidc') {
      return { ok: false, error: `Provider "${req.params.name}" is not an OIDC provider` };
    }
    const config = JSON.parse(provider.configJson) as OidcConfig;
    const discovery = await oidcDiscover(config);
    // PR #31: the `state` + `nonce` are now stored in HttpOnly
    // cookies instead of being echoed to the client. The IdP only
    // sees `state` (it has no use for `nonce`); the callback
    // reads both cookies back and verifies the round-trip.
    const state = `state-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSsoCookies({
      reply,
      provider: provider.name,
      state,
      nonce,
      isHttps: (req.protocol ?? 'http') === 'https',
    });
    const url = `${discovery.authorization_endpoint}?response_type=code&client_id=${encodeURIComponent(config.clientId)}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=${encodeURIComponent((config.scopes ?? ['openid', 'email', 'profile']).join(' '))}&state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`;
    return { ok: true, redirectUrl: url };
  });

  // GET /:name/callback — finalize the OIDC flow (Sprint 6 PR #30,
  // PR #31 cookie work). The IdP redirects the browser here with
  // `?code=…&state=…` after the user signs in. The route:
  //   1. looks up the registered OIDC provider,
  //   2. reads the `state` + `nonce` cookies the login route set
  //      and verifies the `state` query parameter matches the
  //      cookie (CSRF defense — without this an attacker can
  //      complete a sign-in the attacker started),
  //   3. exchanges the authorization code at the IdP's
  //      `token_endpoint`,
  //   4. verifies the returned `id_token` (JWKS RS256, iss/aud/exp
  //      + the nonce the cookie carried),
  //   5. finds the matching local user by the `email` claim,
  //   6. mints the same access + refresh token pair the email/
  //      password flow produces.
  app.get<{ Params: { name: string }; Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/:name/callback',
    async (req, reply) => {
      const provider = await db.query.ssoProviders.findFirst({
        where: eq(ssoProviders.name, req.params.name),
      });
      if (!provider) return { ok: false, error: `SSO provider "${req.params.name}" not found` };
      if (provider.type !== 'oidc') {
        return { ok: false, error: `Provider "${req.params.name}" is not an OIDC provider` };
      }
      // The IdP can redirect back with `?error=…&error_description=…`
      // when the user denies consent or the auth request was bad.
      // Surface the upstream error verbatim — the panel renders it
      // in the SSO error toast. Clear the state cookies either way
      // so a retry does not inherit a stale `state`.
      if (req.query?.error) {
        clearSsoCookies({ reply, provider: provider.name });
        const description = req.query.error_description ?? req.query.error;
        return { ok: false, error: `OIDC provider error: ${description}` };
      }
      const code = req.query?.code;
      if (!code) return { ok: false, error: 'Missing `code` query parameter' };
      const cookies = readSsoCookies({
        cookieHeader: req.headers.cookie,
        provider: provider.name,
      });
      if (!cookies) {
        return {
          ok: false,
          error: 'OIDC state cookie is missing or expired. Restart the sign-in flow.',
        };
      }
      const queryState = req.query?.state;
      if (!queryState || !safeStateEqual(queryState, cookies.state)) {
        clearSsoCookies({ reply, provider: provider.name });
        return { ok: false, error: 'OIDC `state` does not match the cookie (CSRF check failed)' };
      }
      const config = JSON.parse(provider.configJson) as OidcConfig;
      let claims: Awaited<ReturnType<typeof oidcVerifyIdToken>>;
      try {
        const discovery = await oidcDiscover(config);
        const tokens = await oidcExchangeCode(discovery, config, code);
        if (!tokens.id_token) {
          clearSsoCookies({ reply, provider: provider.name });
          return { ok: false, error: 'OIDC token response is missing `id_token`' };
        }
        // The cookie carries the `nonce` the auth request emitted.
        // The id_token's `nonce` claim must match — that's the OIDC
        // spec's replay defense. Empty cookies.nonce would mean
        // someone tampered with the cookie value, which the safe
        // equality check above already rejected.
        claims = await oidcVerifyIdToken(discovery, config, tokens.id_token, cookies.nonce);
      } catch (err) {
        clearSsoCookies({ reply, provider: provider.name });
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // Sign-in succeeded: clear the auth-flow cookies so a stale
      // state from a previous attempt cannot be replayed.
      clearSsoCookies({ reply, provider: provider.name });
      if (!claims.email) {
        return { ok: false, error: 'OIDC id_token is missing the `email` claim' };
      }
      const user = await findUserByEmail(db, claims.email);
      if (!user) {
        return {
          ok: false,
          error: `OIDC sign-in denied: no local user matches ${claims.email}. Operators must be invited first.`,
        };
      }
      const issued = await issueSessionTokens(db, user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return {
        ok: true,
        provider: provider.name,
        subject: { sub: claims.sub, email: claims.email },
        tokens: issued,
      };
    },
  );

  // POST /:name/saml-callback — Sprint 6 PR #23-b, SAML assertion
  // consumer. The IdP POSTs a base64-encoded `<samlp:Response>` here
  // after the user signs in. We decode, parse the IdP-issued
  // metadata to get the signing certificate, verify the XML
  // signature, extract the federated identity (NameID + email
  // attribute), look up the matching local user, and mint a
  // session. Unknown users are rejected — SAML is for existing
  // operators, not a public sign-up path. (Invitations remain the
  // operator-issuance flow.)
  app.post<{ Params: { name: string }; Body: { SAMLResponse?: string } }>(
    '/:name/saml-callback',
    async (req) => {
      const provider = await db.query.ssoProviders.findFirst({
        where: eq(ssoProviders.name, req.params.name),
      });
      if (!provider) return { ok: false, error: `SSO provider "${req.params.name}" not found` };
      if (provider.type !== 'saml') {
        return { ok: false, error: `Provider "${req.params.name}" is not a SAML provider` };
      }
      const samlResponseB64 = req.body?.SAMLResponse;
      if (!samlResponseB64) {
        return { ok: false, error: 'Missing `SAMLResponse` body field' };
      }
      let decoded: string;
      let subject: ReturnType<typeof extractSamlSubject>;
      let certPem: string;
      try {
        decoded = decodeSamlResponse(samlResponseB64);
        subject = extractSamlSubject(decoded);
        // The IdP cert comes from the metadata the operator registered.
        const metadata = JSON.parse(provider.configJson) as { idpMetadata?: string };
        if (!metadata.idpMetadata) {
          return { ok: false, error: 'SAML provider has no idpMetadata configured' };
        }
        const parsed = parseIdpMetadata(metadata.idpMetadata);
        certPem = `-----BEGIN CERTIFICATE-----\n${parsed.signingCert.replace(/\s+/g, '')}\n-----END CERTIFICATE-----`;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // Verify the SAML response signature. The `<SignedInfo>` block
      // is the canonicalized payload the IdP signed; the
      // `<SignatureValue>` carries the base64-encoded signature. We
      // pull both out of the response XML inline here — the
      // IdP-side flow does not give us pre-parsed pieces.
      const signedInfoMatch = /<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/.exec(decoded);
      const signatureValueMatch = /<ds:SignatureValue[^>]*>([\s\S]*?)<\/ds:SignatureValue>/.exec(decoded);
      if (!signedInfoMatch || !signatureValueMatch) {
        return { ok: false, error: 'SAML response: missing <ds:SignedInfo> or <ds:SignatureValue>' };
      }
      const signatureB64 = signatureValueMatch[1]!.replace(/\s+/g, '');
      const signedInfo = signedInfoMatch[0]!;
      let valid: boolean;
      try {
        valid = verifySignedInfo({ signedInfo, signatureB64, certPem });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (!valid) {
        return { ok: false, error: 'SAML response: signature verification failed' };
      }
      // Map the federated identity to a local user. The IdP's
      // `email` attribute is the canonical join key; if the IdP
      // didn't send one we fall back to the NameID, but only when
      // it already looks like an email. Anything else is a
      // misconfiguration we surface, not paper over.
      const lookupEmail = subject.email ?? (subject.nameId.includes('@') ? subject.nameId : null);
      if (!lookupEmail) {
        return { ok: false, error: 'SAML response: no email attribute and NameID is not email-shaped' };
      }
      const user = await findUserByEmail(db, lookupEmail);
      if (!user) {
        return {
          ok: false,
          error: `SAML sign-in denied: no local user matches ${lookupEmail}. Operators must be invited first.`,
        };
      }
      const tokens = await issueSessionTokens(db, user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return {
        ok: true,
        provider: provider.name,
        subject: { nameId: subject.nameId, email: lookupEmail },
        tokens,
      };
    },
  );
};
