import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ssoRoutes } from '../../src/modules/sso.js';
import { buildTestApp, asUser } from '../helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;
const origFetch = globalThis.fetch;

// The `sso` module looks up providers with `db.query.ssoProviders
// .findFirst({ where: eq(ssoProviders.name, ...) })`. Drizzle's
// `eq()` returns a SQL node whose internal shape is not stable
// across versions, so we mock the `eq` import to capture the
// `name` value into a closure variable the fake db reads. The
// real `eq` is preserved for everything else.
let lastSsoName = '';
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: unknown, value: unknown) => {
      if (col && (col as { name?: string }).name === 'name') lastSsoName = String(value);
      return actual.eq(col, value);
    },
  };
});

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
  // Reset the eq() capture between tests so the lookup in a fresh
  // stateful db starts cold.
  lastSsoName = '';
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

  it('returns the configured providers with their createdAt as ISO strings', async () => {
    // The list endpoint maps `createdAt` through `instanceof Date` to
    // handle both Date instances and the raw string form drizzle can
    // return depending on the column type. We exercise the Date branch
    // by inserting a row and then re-listing.
    const rows: Array<{ id: number; type: 'oidc' | 'saml'; name: string; configJson: string; createdAt: Date }> = [];
    const now = new Date('2026-01-01T00:00:00.000Z');
    rows.push({ id: 1, type: 'oidc', name: 'corp', configJson: '{}', createdAt: now });
    const db = {
      select: () => ({ from: () => Promise.resolve(rows) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([rows[0]]) }) }),
      delete: () => ({ where: () => Promise.resolve() }),
      query: { ssoProviders: { findFirst: () => Promise.resolve(undefined) } },
    };
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/providers', headers: asUser() });
    expect(res.json()).toEqual({
      providers: [{ id: 1, type: 'oidc', name: 'corp', createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    await app.close();
  });

  it('stringifies createdAt when the row carries a non-Date value', async () => {
    // Some shimmed db backends return createdAt as a string instead
    // of a Date. The list endpoint must handle both shapes — the
    // fallback `String(r.createdAt)` is the safety net.
    const rows = [{ id: 1, type: 'oidc', name: 'corp', configJson: '{}', createdAt: '2026-02-02' }];
    const db = {
      select: () => ({ from: () => Promise.resolve(rows) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([rows[0]]) }) }),
      delete: () => ({ where: () => Promise.resolve() }),
      query: { ssoProviders: { findFirst: () => Promise.resolve(undefined) } },
    };
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/providers', headers: asUser() });
    expect(res.json()).toEqual({
      providers: [{ id: 1, type: 'oidc', name: 'corp', createdAt: '2026-02-02' }],
    });
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

  it('rejects a missing or empty `name`', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: { type: 'oidc', name: '', config: { issuer: 'x' } },
    });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/`name` is required/);
    await app.close();
  });

  it('rejects a missing or non-object `config`', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: { type: 'oidc', name: 'corp', config: null },
    });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/`config` is required/);
    await app.close();
  });

  it('surfaces insert errors as an `ok: false` envelope (not a thrown 500)', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    // Force `db.insert(...).values(...).returning()` to reject.
    const originalInsert = (app.db as { insert: (t: unknown) => unknown }).insert;
    (app.db as { insert: (t: unknown) => unknown }).insert = () => ({
      values: () => ({
        returning: () => Promise.reject(new Error('unique-name-violation')),
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: { type: 'oidc', name: 'corp', config: { issuer: 'x' } },
    });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unique-name-violation');
    (app.db as { insert: typeof originalInsert }).insert = originalInsert;
    await app.close();
  });

  it('stringifies non-Error insert rejections', async () => {
    // `catch (err)` falls back to `String(err)` when the rejection
    // is not an Error (e.g. a string thrown from a shim). Cover
    // the second branch of `err instanceof Error ? err.message : String(err)`.
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    (app.db as { insert: (t: unknown) => unknown }).insert = () => ({
      values: () => ({
        returning: () => Promise.reject('plain string failure'),
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: { type: 'oidc', name: 'corp', config: { issuer: 'x' } },
    });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('plain string failure');
    await app.close();
  });

  it('handles a missing request body without throwing', async () => {
    // The route destructures `req.body ?? {}` to defend against a
    // body parser failure / empty payload. POST with no body at all
    // exercises the `??` fallback.
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
    });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    // The first validation to fire is the `type` check.
    expect(body.error).toMatch(/`type` must be/);
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
  // A tiny in-memory sso store. The createFakeDb defaults don't
  // persist between requests — `db.query.ssoProviders.findFirst`
  // returns `undefined` for any name because `createFakeDb` only
  // populates rows it knows about — so a POST-then-GET round-trip
  // needs a stateful stub. The mocked `eq` (above) captures the
  // `name` value into `lastSsoName` for us.
  function statefulDb() {
    const rows: Array<{ id: number; type: 'oidc' | 'saml'; name: string; configJson: string; createdAt: Date }> = [];
    let nextId = 1;
    return {
      select: () => ({ from: () => Promise.resolve(rows) }),
      insert: () => ({
        values: (v: { type: 'oidc' | 'saml'; name: string; configJson: string }) => ({
          returning: () => {
            const row = { id: nextId++, ...v, createdAt: new Date() };
            rows.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      query: {
        ssoProviders: {
          findFirst: () => Promise.resolve(rows.find((r) => r.name === lastSsoName)),
        },
      },
    };
  }

  it('returns 404 for an unknown provider', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/missing/login', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    await app.close();
  });

  it('rejects a non-OIDC provider (SAML login is wired in PR #23-b)', async () => {
    const db = statefulDb();
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    const create = await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: {
        type: 'saml',
        name: 'corp-saml',
        config: { idpMetadataUrl: 'https://idp.example.com/metadata' },
      },
    });
    expect(create.json().ok).toBe(true);
    const login = await app.inject({ method: 'GET', url: '/corp-saml/login', headers: asUser() });
    const body = login.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not an OIDC provider/);
    await app.close();
  });

  it('builds a discovery-backed authorization URL for an OIDC provider', async () => {
    const db = statefulDb();
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: {
        type: 'oidc',
        name: 'corp-oidc',
        config: {
          issuer: 'https://idp.example.com',
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'https://app.example.com/cb',
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/corp-oidc/login', headers: asUser() });
    const body = res.json() as { ok: boolean; redirectUrl?: string; state?: string; nonce?: string };
    expect(body.ok).toBe(true);
    expect(body.redirectUrl).toBeDefined();
    // The redirect URL must point at the IdP's authorization_endpoint
    // (from the mocked discovery) and carry every required OIDC param.
    expect(body.redirectUrl!).toMatch(/^https:\/\/idp\.example\.com\/auth\?/);
    expect(body.redirectUrl!).toContain('response_type=code');
    expect(body.redirectUrl!).toContain('client_id=cid');
    expect(body.redirectUrl!).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb');
    expect(body.redirectUrl!).toContain('scope=openid%20email%20profile');
    expect(body.state).toMatch(/^state-/);
    expect(body.nonce).toMatch(/^nonce-/);
    // Every call generates a fresh state + nonce — critical for CSRF /
    // replay protection in the eventual session-mint path.
    expect(body.state).not.toEqual(body.nonce);
    await app.close();
  });
});

describe('GET /v1/sso/:name/callback', () => {
  function statefulDb() {
    const rows: Array<{ id: number; type: 'oidc' | 'saml'; name: string; configJson: string; createdAt: Date }> = [];
    let nextId = 1;
    return {
      select: () => ({ from: () => Promise.resolve(rows) }),
      insert: () => ({
        values: (v: { type: 'oidc' | 'saml'; name: string; configJson: string }) => ({
          returning: () => {
            const row = { id: nextId++, ...v, createdAt: new Date() };
            rows.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      query: {
        ssoProviders: {
          findFirst: () => Promise.resolve(rows.find((r) => r.name === lastSsoName)),
        },
      },
    };
  }

  it('returns 404 for an unknown provider', async () => {
    const app = await buildTestApp();
    await app.register(ssoRoutes);
    const res = await app.inject({ method: 'GET', url: '/missing/callback?code=x', headers: asUser() });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not found/);
    await app.close();
  });

  it('rejects a non-OIDC provider', async () => {
    const db = statefulDb();
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: { type: 'saml', name: 'corp-saml', config: { idpMetadataUrl: 'x' } },
    });
    const res = await app.inject({ method: 'GET', url: '/corp-saml/callback?code=x', headers: asUser() });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not an OIDC provider/);
    await app.close();
  });

  it('rejects when the `code` query parameter is missing', async () => {
    const db = statefulDb();
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: {
        type: 'oidc',
        name: 'corp-oidc',
        config: { issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://app/cb' },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/corp-oidc/callback', headers: asUser() });
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Missing `code`/);
    await app.close();
  });

  it('returns the discovery metadata and redacts the auth code (PR #23-b owns the session mint)', async () => {
    const db = statefulDb();
    const app = await buildTestApp({ db: db as never });
    await app.register(ssoRoutes);
    await app.inject({
      method: 'POST',
      url: '/providers',
      headers: asUser(),
      payload: {
        type: 'oidc',
        name: 'corp-oidc',
        config: { issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://app/cb' },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/corp-oidc/callback?code=opaque-auth-code-12345',
      headers: asUser(),
    });
    const body = res.json() as {
      ok: boolean;
      provider?: string;
      issuer?: string;
      jwks?: string;
      tokenEndpoint?: string;
      code?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('corp-oidc');
    expect(body.issuer).toBe('https://idp.example.com');
    expect(body.jwks).toBe('https://idp.example.com/jwks');
    expect(body.tokenEndpoint).toBe('https://idp.example.com/token');
    // The raw `code` is never echoed back — the response placeholder
    // signals to the caller that the real session mints in PR #23-b.
    expect(body.code).toBe('[redacted — session mints in PR #23-b]');
    expect(body.code).not.toContain('opaque-auth-code-12345');
    await app.close();
  });
});
