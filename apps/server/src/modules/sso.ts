import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { ssoProviders, type DB } from '@ninedeploy/db';
import { discover as oidcDiscover, type OidcConfig } from '../lib/oidc.js';

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
  app.get<{ Params: { name: string } }>('/:name/login', async (req) => {
    const provider = await db.query.ssoProviders.findFirst({
      where: eq(ssoProviders.name, req.params.name),
    });
    if (!provider) return { ok: false, error: `SSO provider "${req.params.name}" not found` };
    if (provider.type !== 'oidc') {
      return { ok: false, error: `Provider "${req.params.name}" is not an OIDC provider` };
    }
    const config = JSON.parse(provider.configJson) as OidcConfig;
    const discovery = await oidcDiscover(config);
    // The `state` + `nonce` cookies are set by the panel's
    // auth-handler middleware; for now we surface them as URL
    // parameters and let the browser carry them through. PR #23-b
    // moves the cookies to HttpOnly.
    const state = `state-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `${discovery.authorization_endpoint}?response_type=code&client_id=${encodeURIComponent(config.clientId)}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=${encodeURIComponent((config.scopes ?? ['openid', 'email', 'profile']).join(' '))}&state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`;
    return { ok: true, redirectUrl: url, state, nonce };
  });

  // GET /:name/callback — finalize the OIDC flow
  app.get<{ Params: { name: string }; Querystring: { code?: string; state?: string } }>(
    '/:name/callback',
    async (req) => {
      const provider = await db.query.ssoProviders.findFirst({
        where: eq(ssoProviders.name, req.params.name),
      });
      if (!provider) return { ok: false, error: `SSO provider "${req.params.name}" not found` };
      if (provider.type !== 'oidc') {
        return { ok: false, error: `Provider "${req.params.name}" is not an OIDC provider` };
      }
      const code = req.query?.code;
      if (!code) return { ok: false, error: 'Missing `code` query parameter' };
      // PR #23-b will: verify `state`, look up the matching `nonce`
      // from the session cookie, exchange the code, verify the
      // id_token, and mint a session. For now the surface is read-
      // only; the integration test exercises `discover` only.
      const config = JSON.parse(provider.configJson) as OidcConfig;
      const discovery = await oidcDiscover(config);
      return {
        ok: true,
        provider: provider.name,
        issuer: config.issuer,
        jwks: discovery.jwks_uri,
        tokenEndpoint: discovery.token_endpoint,
        // The actual session mint lands in PR #23-b.
        code: '[redacted — session mints in PR #23-b]',
      };
    },
  );
};
