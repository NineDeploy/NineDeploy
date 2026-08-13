import { describe, expect, it, vi } from 'vitest';
import { dashboardRoutes } from '../src/modules/dashboard.js';
import { asUser, buildTestApp, createFakeDb, depRow, svcRow } from './helpers.js';

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(async () => 'a\nb\n'),
  run: vi.fn(async (_c: unknown, _a: unknown, _o: unknown, sink?: (l: string) => void) => { sink?.('out'); }),
}));
vi.mock('../src/lib/exec.js', () => execMocks);

describe('dashboard routes', () => {
  it('aggregates stats, health and recent deploys', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [
            svcRow({ id: 1, status: 'running', port: 3000, runtimeId: 'c1' }),
            svcRow({ id: 2, status: 'stopped', port: 3001 }),
            svcRow({ id: 3, status: 'running', port: null }),
            svcRow({ id: 4, status: 'error', port: 3002 }),
          ],
          databases: [svcRow({ id: 5, status: 'running' })],
        },
        counts: {
          services: [{ n: 4 }],
          databases: [{ n: 1 }],
          deployments: [{ n: 9 }],
          domains: [{ n: 2 }],
          webhooks: [{ n: 3 }],
        },
        findMany: {
          deployments: [
            depRow({ id: 10, serviceId: 1, status: 'running', finishedAt: new Date('2026-01-02T00:00:00Z') }),
            depRow({ id: 11, serviceId: 99, status: 'failed', commitSha: null, message: null }),
          ],
        },
        findFirst: {
          deployments: depRow({ id: 10, serviceId: 1, createdAt: new Date('2026-01-02T00:00:00Z') }),
        },
      }),
    });
    await app.register(dashboardRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats).toEqual({
      services: 4,
      databases: 1,
      deployments: 9,
      domains: 2,
      webhooks: 3,
      running: 2,
      stopped: 1,
      errored: 1,
      dbRunning: 1,
      containers: 2,
    });
    expect(body.recentDeploys[0]).toMatchObject({
      id: 10,
      serviceId: 1,
      serviceName: 'web',
      commitSha: 'abcdef1',
      finishedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(body.recentDeploys[1]).toMatchObject({ serviceId: 99, serviceName: 'unknown', finishedAt: null });
    expect(body.health).toHaveLength(4);
    expect(body.health[0]).toMatchObject({ serviceId: 1, healthy: true, responseMs: expect.any(Number) });
    expect(body.health[1]).toMatchObject({ serviceId: 2, healthy: false, responseMs: null });
    expect(body.health[2]).toMatchObject({ serviceId: 3, healthy: true, responseMs: null, port: null });
    expect(body.health[3]).toMatchObject({ serviceId: 4, healthy: false });
    expect(body.health[0].lastDeploy).toBe('2026-01-02T00:00:00.000Z');
  });

  it('marks a service unhealthy when its probe returns a 5xx', async () => {
    const fetchMock = vi.fn(async () => ({ status: 500, ok: false })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp({
      db: createFakeDb({
        select: { services: [svcRow({ id: 1, status: 'running', port: 3000 })] },
        counts: {},
      }),
    });
    await app.register(dashboardRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().health[0].healthy).toBe(false);
  });

  it('marks a service unhealthy when the probe rejects', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildTestApp({
      db: createFakeDb({
        select: { services: [svcRow({ id: 1, status: 'running', port: 3000, commitSha: 'long-sha' })] },
        counts: {},
      }),
    });
    await app.register(dashboardRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().health[0]).toMatchObject({ healthy: false, responseMs: null });
  });

  it('treats a missing docker binary as zero containers', async () => {
    execMocks.capture.mockRejectedValueOnce(new Error('docker not found'));
    const app = await buildTestApp({
      db: createFakeDb({ select: { services: [] }, counts: {} }),
    });
    await app.register(dashboardRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().stats.containers).toBe(0);
  });

  it('handles a service with no deployments', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        select: { services: [svcRow({ id: 1, status: 'idle', port: null, commitSha: null })] },
        counts: {},
      }),
    });
    await app.register(dashboardRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().health[0]).toMatchObject({ serviceId: 1, healthy: false, lastDeploy: null, commitSha: null });
    expect(res.json().recentDeploys).toEqual([]);
  });
});
