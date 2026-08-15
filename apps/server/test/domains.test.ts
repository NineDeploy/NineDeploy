import { describe, expect, it, vi } from 'vitest';
import { domainsRoutes } from '../src/modules/domains.js';
import { asUser, buildTestApp, createFakeDb, domainRow, svcRow } from './helpers.js';

const proxyMocks = vi.hoisted(() => ({
  writeDynamicConfig: vi.fn(async () => undefined),
  // The real sanitizer (imported by the module under test from the same path).
  parseHeaders: (raw: string | null | undefined) => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((i): i is { name: string; value: string } =>
          typeof (i as { name?: unknown })?.name === 'string' && typeof (i as { value?: unknown })?.value === 'string')
        .map((h) => ({ name: h.name.replace(/[^A-Za-z0-9-]/g, ''), value: h.value.replace(/["\\\n\r]/g, '') }))
        .filter((h) => h.name.length > 0);
    } catch {
      return [];
    }
  },
}));
vi.mock('../src/engine/proxy.js', () => proxyMocks);

describe('domains routes', () => {
  it('lists domains for a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { domains: [domainRow({ id: 2, hostname: 'a.example.com', ssl: true })] } }),
    });
    await app.register(domainsRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/domains', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: 2,
        serviceId: 1,
        hostname: 'a.example.com',
        path: '/',
        ssl: true,
        redirectWww: false,
        headers: '[]',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('creates a domain for an existing service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        insert: { domains: [domainRow({ id: 3, hostname: 'new.example.com', ssl: true })] },
      }),
    });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/domains',
      headers: asUser(),
      payload: { hostname: 'new.example.com', path: '/', ssl: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 3, hostname: 'new.example.com', ssl: true });
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('returns 404 when the service is missing', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/99/domains',
      headers: asUser(),
      payload: { hostname: 'x.example.com' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when the host already exists', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        insert: { domains: () => { throw new Error('UNIQUE'); } },
      }),
    });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/domains',
      headers: asUser(),
      payload: { hostname: 'dup.example.com' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
  });

  it('deletes a domain and regenerates the proxy config', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(domainsRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1/domains/3', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('rejects an invalid create payload', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/domains',
      headers: asUser(),
      payload: { hostname: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  // ── routing extras: ssl / www redirect / headers ─────────────────────────
  it('patches ssl, redirectWww and headers together', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        update: {
          domains: [domainRow({ id: 3, ssl: true, redirectWww: true, headers: '[{"name":"X-Frame-Options","value":"DENY"}]' })],
        },
      }),
    });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/domains/3',
      headers: asUser(),
      payload: { ssl: true, redirectWww: true, headers: '[{"name":"X-Frame-Options","value":"DENY"}]' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 3, ssl: true, redirectWww: true });
    expect(JSON.parse(res.json().headers)).toEqual([{ name: 'X-Frame-Options', value: 'DENY' }]);
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('sanitizes a hostile headers payload on patch', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        update: { domains: [domainRow({ id: 3, headers: '[{"name":"BadName","value":"ok"}]' })] },
      }),
    });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/domains/3',
      headers: asUser(),
      payload: { headers: '[{"name":"Bad\\"Name","value":"ok"}]' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.json().headers)).toEqual([{ name: 'BadName', value: 'ok' }]);
  });

  it('returns 404 when patching a missing domain', async () => {
    const app = await buildTestApp({ db: createFakeDb({ update: { domains: [] } }) });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/domains/99',
      headers: asUser(),
      payload: { ssl: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('accepts an empty patch body', async () => {
    const app = await buildTestApp({ db: createFakeDb({ update: { domains: [domainRow({ id: 3 })] } }) });
    await app.register(domainsRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/1/domains/3', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an invalid patch payload', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(domainsRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/domains/3',
      headers: asUser(),
      payload: { ssl: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});
