import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { issueSessionTokens } from '../src/lib/sessions.js';
import { oidcProviders, users, workspaceMembers, workspaces } from '@ninedeploy/db';
import { generateOAuthState } from '../src/lib/oauth.js';
import { encrypt } from '../src/lib/crypto.js';
import { eq } from 'drizzle-orm';

describe('OIDC and OAuth2 SSO endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memberToken: string;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    app = await buildApp();

    await app.db.delete(oidcProviders);
    await app.db.delete(workspaceMembers);
    await app.db.delete(workspaces);
    await app.db.delete(users);

    const [admin] = await app.db
      .insert(users)
      .values({ email: 'admin@oidc.test', passwordHash: 'hash', name: 'Admin', role: 'admin' })
      .returning();
    const adminSession = await issueSessionTokens(app.db, admin);
    adminToken = adminSession.accessToken;

    const [member] = await app.db
      .insert(users)
      .values({ email: 'member@oidc.test', passwordHash: 'hash', name: 'Member', role: 'member' })
      .returning();
    const memberSession = await issueSessionTokens(app.db, member);
    memberToken = memberSession.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('OIDC Providers Management (Admin)', () => {
    let createdId: number;

    it('requires admin privileges to manage providers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/providers',
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {
          name: 'Okta SSO',
          slug: 'okta',
          issuerUrl: 'https://okta.example.com',
          clientId: 'okta-id',
          clientSecret: 'okta-secret',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('creates a new OIDC provider', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/providers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Okta SSO',
          slug: 'okta',
          issuerUrl: 'https://okta.example.com',
          clientId: 'okta-id',
          clientSecret: 'okta-secret',
          scopes: 'openid profile email',
          enabled: true,
          autoEnroll: true,
          defaultRole: 'member',
        },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.slug).toBe('okta');
      expect(data.enabled).toBe(true);
      expect(data.clientSecret).toBeUndefined(); // Secret must never be leaked
      createdId = data.id;
    });

    it('creates a provider without issuerUrl (GitHub style)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/providers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'GitHub OAuth Provider',
          slug: 'gh-oauth',
          clientId: 'gh-cid',
          clientSecret: 'gh-csec',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().issuerUrl).toBeNull();
    });

    it('rejects duplicate slug (409)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/providers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Okta SSO 2',
          slug: 'okta',
          clientId: 'okta-id-2',
          clientSecret: 'secret',
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('lists all providers for admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/providers',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(list).toHaveLength(2);
      expect(list.some((p: any) => p.slug === 'okta')).toBe(true);
      expect(list.some((p: any) => p.slug === 'gh-oauth')).toBe(true);
    });

    it('lists enabled providers on public endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/providers/public',
      });
      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(list).toHaveLength(2);
      expect(list.some((p: any) => p.slug === 'okta')).toBe(true);
    });

    it('updates provider settings', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/auth/oidc/providers/${createdId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Okta Enterprise SSO',
          issuerUrl: 'https://okta.enterprise.test',
          clientId: 'new-client-id',
          clientSecret: 'new-okta-secret',
          scopes: 'openid email',
          enabled: true,
          autoEnroll: false,
          defaultRole: 'admin',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Okta Enterprise SSO');
      expect(res.json().clientId).toBe('new-client-id');
      expect(res.json().autoEnroll).toBe(false);
      expect(res.json().defaultRole).toBe('admin');

      const resNullIssuer = await app.inject({
        method: 'PATCH',
        url: `/v1/auth/oidc/providers/${createdId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          issuerUrl: null,
        },
      });
      expect(resNullIssuer.statusCode).toBe(200);
      expect(resNullIssuer.json().issuerUrl).toBeNull();
    });

    it('returns 404 for updating non-existent provider', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/auth/oidc/providers/99999',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'None' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('deletes provider', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/auth/oidc/providers/${createdId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const check = await app.inject({
        method: 'DELETE',
        url: `/v1/auth/oidc/providers/${createdId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(check.statusCode).toBe(404);
    });
  });

  describe('Login Initiation (/v1/auth/oidc/:slug/login)', () => {
    beforeAll(async () => {
      await app.db.insert(oidcProviders).values([
        {
          name: 'Google Workspace',
          slug: 'google',
          issuerUrl: 'https://accounts.google.com',
          clientId: 'google-client-id',
          clientSecretEncrypted: encrypt('google-secret'),
          scopes: 'openid email profile',
          enabled: true,
          autoEnroll: true,
          defaultRole: 'member',
        },
        {
          name: 'GitHub SSO',
          slug: 'github',
          issuerUrl: null,
          clientId: 'gh-client-id',
          clientSecretEncrypted: encrypt('gh-secret'),
          scopes: 'read:user user:email',
          enabled: true,
          autoEnroll: true,
          defaultRole: 'member',
        },
        {
          name: 'Disabled SSO',
          slug: 'disabled',
          issuerUrl: 'https://disabled.example.com',
          clientId: 'id',
          clientSecretEncrypted: encrypt('enc'),
          enabled: false,
          autoEnroll: false,
          defaultRole: 'member',
        },
      ]);
    });

    it('returns 404 for non-existent or disabled provider', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/unknown/login',
      });
      expect(res.statusCode).toBe(404);

      const resDisabled = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/disabled/login',
      });
      expect(resDisabled.statusCode).toBe(404);
    });

    it('initiates GitHub OAuth login and redirects', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/github/login?returnTo=/dashboard',
      });
      expect(res.statusCode).toBe(302);
      const location = res.headers.location;
      expect(location).toContain('https://github.com/login/oauth/authorize');
      expect(location).toContain('client_id=gh-client-id');
    });

    it('returns JSON authUrl when requested', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
        }),
      } as never);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/google/login?json=true',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });
  });

  describe('Callback & Token Exchange (/v1/auth/oidc/:slug/callback)', () => {
    it('handles provider error param (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/google/callback?error=access_denied&error_description=User+denied+access',
      });
      expect(res.statusCode).toBe(401);

      const resNoErrorDesc = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/google/callback?error=unknown_error',
      });
      expect(resNoErrorDesc.statusCode).toBe(401);
    });

    it('handles missing code or state (400)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/google/callback?code=abc',
      });
      expect(res.statusCode).toBe(400);
    });

    it('handles invalid or expired state (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/google/callback?code=abc&state=badstate',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 if provider was deleted/disabled before callback', async () => {
      const state = generateOAuthState('deleted-provider', '/');
      const res = await app.inject({
        method: 'GET',
        url: `/v1/auth/oidc/deleted-provider/callback?code=abc&state=${encodeURIComponent(state)}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('handles successful OIDC login and user creation on POST callback', async () => {
      const state = generateOAuthState('google', '/services');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          // OIDC Discovery
          ok: true,
          json: async () => ({
            authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
            userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
          }),
        } as never)
        .mockResolvedValueOnce({
          // Token exchange
          ok: true,
          json: async () => ({ access_token: 'google_at_123' }),
        } as never)
        .mockResolvedValueOnce({
          // User info
          ok: true,
          json: async () => ({ sub: 'g_user_1', email: 'sam@google.test', name: 'Sam Google' }),
        } as never);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/google/callback',
        payload: {
          code: 'valid_code',
          state,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.user.email).toBe('sam@google.test');
      expect(data.tokens.accessToken).toBeDefined();

      // Ensure user and workspace were created
      const dbUser = await app.db.query.users.findFirst({ where: eq(users.email, 'sam@google.test') });
      expect(dbUser).toBeDefined();
      const ws = await app.db.query.workspaces.findFirst({ where: eq(workspaces.ownerId, dbUser!.id) });
      expect(ws).toBeDefined();
    });

    it('falls back to default /userinfo URL and honors valid returnTo path', async () => {
      const state = generateOAuthState('google', '/settings/profile');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          // OIDC Discovery WITHOUT userinfo_endpoint
          ok: true,
          json: async () => ({
            authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
          }),
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'google_at_123' }),
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sub: 'g_user_99', email: 'sam@google.test' }),
        } as never);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/auth/oidc/google/callback?code=valid_code&state=${encodeURIComponent(state)}`,
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('/settings/profile#access_token=');
    });

    it('creates admin user if first user in database registers via SSO', async () => {
      // Clear users table temporarily
      await app.db.delete(users);

      const state = generateOAuthState('google', '/');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
            userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
          }),
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'first_admin_token' }),
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sub: 'first_admin', email: 'founder@google.test' }),
        } as never);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/google/callback',
        payload: { code: 'code', state },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.role).toBe('admin');
    });

    it('handles successful GitHub login and redirects with tokens in URL hash fragment', async () => {
      const state = generateOAuthState('github', 'https://evil.com'); // returnTo not starting with /

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          // GitHub access token
          ok: true,
          json: async () => ({ access_token: 'gho_token_456' }),
        } as never)
        .mockResolvedValueOnce({
          // GitHub profile - existing user
          ok: true,
          json: async () => ({ id: 45678, login: 'githubdev', name: 'Member', email: 'member@oidc.test' }),
        } as never);

      const res = await app.inject({
        method: 'GET',
        url: `/v1/auth/oidc/github/callback?code=gh_code&state=${encodeURIComponent(state)}`,
      });

      expect(res.statusCode).toBe(302);
      const location = res.headers.location;
      expect(location).toContain('/#access_token=');
      expect(location).toContain('&refresh_token=');
    });

    it('rejects OIDC login initiation if non-github provider has no issuerUrl', async () => {
      await app.db.insert(oidcProviders).values({
        name: 'Bad OIDC',
        slug: 'bad-oidc',
        issuerUrl: null,
        clientId: 'id',
        clientSecretEncrypted: encrypt('secret'),
        enabled: true,
      });

      const resLogin = await app.inject({
        method: 'GET',
        url: '/v1/auth/oidc/bad-oidc/login',
      });
      expect(resLogin.statusCode).toBe(400);

      const state = generateOAuthState('bad-oidc', '/');
      const resCb = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/bad-oidc/callback',
        payload: { code: 'code', state },
      });
      expect(resCb.statusCode).toBe(400);
    });

    it('forbids login when auto-enrollment is disabled for new user (403)', async () => {
      await app.db
        .insert(oidcProviders)
        .values({
          name: 'Closed Provider',
          slug: 'closed',
          issuerUrl: 'https://closed.example.com',
          clientId: 'cid',
          clientSecretEncrypted: encrypt('enc'),
          enabled: true,
          autoEnroll: false,
          defaultRole: 'member',
        })
        .returning();

      const state = generateOAuthState('closed', '/');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token_endpoint: 'https://closed.example.com/token',
            userinfo_endpoint: 'https://closed.example.com/userinfo',
          }),
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'closed_at' }),
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sub: 'closed_sub', email: 'brandnew@closed.test' }),
        } as never);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/oidc/closed/callback',
        payload: {
          code: 'closed_code',
          state,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain('Auto-enrollment is disabled');
    });
  });
});
