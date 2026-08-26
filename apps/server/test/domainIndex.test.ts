import { describe, expect, it, vi } from 'vitest';
import { domainIndexRoutes } from '../src/modules/domainIndex.js';
import { asUser, buildTestApp, createFakeDb, domainRow, svcRow } from './helpers.js';

const proxyMocks = vi.hoisted(() => ({
  writeDynamicConfig: vi.fn(async () => undefined),
  readCertificates: vi.fn(() => []),
}));
vi.mock('../src/engine/proxy.js', () => proxyMocks);

describe('domain index routes', () => {
  it('lists domains joined with their services', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          domains: [
            domainRow({ id: 1, serviceId: 1, hostname: 'a.example.com' }),
            domainRow({ id: 2, serviceId: 99, hostname: 'orphan.example.com' }),
          ],
        },
        select: { services: [svcRow({ id: 1, runtimeId: 'c1', port: 3000, name: 'web' })] },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows[0]).toMatchObject({
      id: 1,
      hostname: 'a.example.com',
      serviceId: 1,
      serviceName: 'web',
      container: 'c1',
      port: 3000,
    });
    expect(rows[1]).toMatchObject({ id: 2, serviceId: 99, serviceName: null, container: null, port: null });
    // No acme.json â†’ no cert info.
    expect(rows[0]).toMatchObject({ certExpiresAt: null });
  });

  it('limits a member to domains on services they own', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          domains: [
            domainRow({ id: 1, serviceId: 1, hostname: 'mine.example.com' }),
            domainRow({ id: 2, serviceId: 2, hostname: 'theirs.example.com' }),
          ],
        },
        select: {
          services: [
            svcRow({ id: 1, ownerUserId: 7 }),
            svcRow({ id: 2, ownerUserId: 9 }),
          ],
        },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser({ id: 7, isOperator: false }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((domain: { hostname: string }) => domain.hostname)).toEqual(['mine.example.com']);
  });

  it('attaches certificate expiry to matching hostnames', async () => {
    proxyMocks.readCertificates.mockReturnValueOnce([
      { domain: 'a.example.com', expiresAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: { domains: [domainRow({ id: 1, serviceId: 1, hostname: 'a.example.com' })] },
        select: { services: [] },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ certExpiresAt: '2026-09-01T00:00:00.000Z' });
  });

  it('enables ssl on a domain and regenerates the proxy config', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          domains: domainRow({ id: 1, serviceId: 1 }),
          services: svcRow({ id: 1 }),
        },
        update: { domains: [domainRow({ id: 1, ssl: true })] },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1',
      headers: asUser(),
      payload: { ssl: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 1, ssl: true });
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('defaults ssl to false when omitted', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          domains: domainRow({ id: 1, serviceId: 1 }),
          services: svcRow({ id: 1 }),
        },
        update: { domains: [domainRow({ id: 1, ssl: false })] },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/1', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 1, ssl: false });
  });

  it('defaults ssl to false when no body is sent', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          domains: domainRow({ id: 1, serviceId: 1 }),
          services: svcRow({ id: 1 }),
        },
        update: { domains: [domainRow({ id: 1, ssl: false })] },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 1, ssl: false });
  });

  it('returns 404 when the domain is missing', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          domains: undefined,
          services: svcRow({ id: 1 }),
        },
        update: { domains: [] },
      }),
    });
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/99', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid domain id before querying', async () => {
    const app = await buildTestApp();
    await app.register(domainIndexRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/not-an-id', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_id');
  });
});
