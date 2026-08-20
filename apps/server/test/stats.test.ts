import { describe, expect, it } from 'vitest';
import { metricRoutes, statsRoutes } from '../src/modules/stats.js';
import { asUser, buildTestApp, createFakeDb, dbRow, metricRow, svcRow } from './helpers.js';

const containers = new Map<string, unknown>([
  ['c1', { name: 'c1', cpuPct: 0.5, memBytes: 1024 * 1024 * 120, memLimitBytes: 1024 * 1024 * 256 }],
  ['c2', { name: 'c2', cpuPct: 1, memBytes: 1024 * 1024 * 10, memLimitBytes: 0 }],
  ['nd-db-pg', { name: 'nd-db-pg', cpuPct: 0.5, memBytes: 1024 * 1024 * 120, memLimitBytes: 1024 * 1024 * 256 }],
  ['nd-db-free', { name: 'nd-db-free', cpuPct: 1, memBytes: 1024 * 1024 * 10, memLimitBytes: 0 }],
]);

describe('stats routes', () => {
  it('maps running containers to services and databases', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [
            svcRow({ id: 1, runtimeId: 'c1', name: 'web' }),
            svcRow({ id: 2, runtimeId: 'c2', name: 'unlimited' }),
            svcRow({ id: 3, runtimeId: 'c-missing', name: 'ghost' }),
            svcRow({ id: 4, runtimeId: null, name: 'idle' }),
          ],
          databases: [
            dbRow({ id: 5, containerName: 'nd-db-pg', name: 'pg' }),
            dbRow({ id: 6, containerName: 'nd-db-free', name: 'free', engine: 'redis' }),
            dbRow({ id: 7, containerName: 'nd-db-gone', name: 'gone' }),
            dbRow({ id: 8, containerName: null, name: 'empty' }),
          ],
        },
      }),
      stats: {
        containers,
        host: { cpuCores: 8 },
      },
    });
    await app.register(statsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host).toEqual({ cpuCores: 8 });
    expect(body.containers).toEqual([
      { name: 'c1', kind: 'service', refId: 1, refName: 'web', cpuPct: 0.5, memMb: 120, memLimitMb: 256 },
      { name: 'c2', kind: 'service', refId: 2, refName: 'unlimited', cpuPct: 1, memMb: 10, memLimitMb: 0 },
      { name: 'nd-db-pg', kind: 'database', refId: 5, refName: 'pg', engine: 'postgres', cpuPct: 0.5, memMb: 120, memLimitMb: 256 },
      { name: 'nd-db-free', kind: 'database', refId: 6, refName: 'free', engine: 'redis', cpuPct: 1, memMb: 10, memLimitMb: 0 },
    ]);
  });

  it('returns an empty container list when nothing is running', async () => {
    const app = await buildTestApp({ db: createFakeDb(), stats: { containers: new Map(), host: null } });
    await app.register(statsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ host: null, containers: [] });
  });

  it('limits live container stats to resources visible to a member', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [
            svcRow({ id: 1, ownerUserId: 7, runtimeId: 'c1', name: 'mine' }),
            svcRow({ id: 2, ownerUserId: 9, runtimeId: 'c2', name: 'theirs' }),
          ],
          databases: [],
        },
      }),
      stats: { containers, host: { cpuCores: 8 } },
    });
    await app.register(statsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser({ id: 7, role: 'member' }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().containers.map((entry: { refId: number }) => entry.refId)).toEqual([1]);
  });
});

describe('metric routes', () => {
  it('returns cpu points by default (storage pct×100 → display %)', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { metrics: [metricRow({ value: 325, ts: new Date('2026-01-01T00:01:00Z') })] }, findFirst: { services: svcRow({ id: 1 }) } }),
    });
    await app.register(metricRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/metrics', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'cpu', points: [{ ts: '2026-01-01T00:01:00.000Z', value: 3.25 }] });
  });

  it('returns memory points when requested', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { metrics: [metricRow({ kind: 'memory', value: 42 * 1024 * 1024 })] }, findFirst: { services: svcRow({ id: 1 }) } }),
    });
    await app.register(metricRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/metrics?kind=memory&minutes=10', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe('memory');
    expect(res.json().points).toEqual([{ ts: '2026-01-01T00:00:00.000Z', value: 42 }]);
  });

  it('clamps minutes to the allowed range', async () => {
    const app = await buildTestApp({ db: createFakeDb({ findMany: { metrics: [] }, findFirst: { services: svcRow({ id: 1 }) } }) });
    await app.register(metricRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/metrics?minutes=99999', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toEqual([]);
  });

  it('falls back to 60 minutes for invalid values', async () => {
    const app = await buildTestApp({ db: createFakeDb({ findMany: { metrics: [] }, findFirst: { services: svcRow({ id: 1 }) } }) });
    await app.register(metricRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/metrics?minutes=0', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe('cpu');
  });

  it('falls back to live container stats when no metrics are in db', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: { metrics: [] },
        findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) },
      }),
      stats: { containers, host: null },
    });
    await app.register(metricRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/metrics?kind=cpu', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toHaveLength(1);
    expect(res.json().points[0].value).toBe(0.5);

    const resMem = await app.inject({ method: 'GET', url: '/1/metrics?kind=memory', headers: asUser() });
    expect(resMem.statusCode).toBe(200);
    expect(resMem.json().points[0].value).toBe(120);
  });

  it('returns 404 for another members service metrics', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, ownerUserId: 9 }) } }),
    });
    await app.register(metricRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/metrics', headers: asUser({ id: 7, role: 'member' }) });
    expect(res.statusCode).toBe(404);
  });
});
