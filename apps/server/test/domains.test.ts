import { describe, expect, it, vi } from 'vitest';
import { domainsRoutes } from '../src/modules/domains.js';
import { asUser, buildTestApp, createFakeDb, domainRow, svcRow } from './helpers.js';

const proxyMocks = vi.hoisted(() => ({ writeDynamicConfig: vi.fn(async () => undefined) }));
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
});
