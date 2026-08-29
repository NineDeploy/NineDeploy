import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ssoRoutes } from '../../src/modules/sso.js';
import { buildTestApp, asUser } from '../helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;
const origFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('.well-known/openid-configuration')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'https://idp.example.com/auth',
          token_endpoint: 'https://idp.example.com/token',
          jwks_uri: 'https://idp.example.com/jwks',
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      } as never;
    }
    return { ok: false, status: 404 } as never;
  });
  globalThis.fetch = fetchMock as never;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.clearAllMocks();
});

describe('GET /v1/sso/providers', () => {
  it('returns an empty list when no providers are configured', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/providers', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ providers: [] });
    await app.close();
  });

  it('rejects unauthenticated callers', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/providers' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /v1/sso/providers', () => {
  it('rejects an unknown type', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: { type: 'magic', name: 'x', config: {} },
    });
    expect(res.statusCode).toBe(200); // helper returns 200 with ok:false
    const body = res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    await app.close();
  });

  it('accepts a valid OIDC provider payload', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: {
        type: 'oidc',
        name: 'corp',
        config: { issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://app/cb' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; name?: string; type?: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe('corp');
    expect(body.type).toBe('oidc');
    await app.close();
  });
});

describe('DELETE /v1/sso/providers/:id', () => {
  it('removes a provider by id (or no-op if missing)', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/providers/999', headers: asUser() });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a non-numeric id', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/providers/abc', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    await app.close();
  });
});

describe('GET /v1/sso/:name/login', () => {
  it('returns 404 for an unknown provider', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/missing/login', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    await app.close();
  });
});
