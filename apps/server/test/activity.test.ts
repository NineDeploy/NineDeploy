import { describe, expect, it, vi } from 'vitest';
import { activityRoutes } from '../src/modules/activity.js';
import { asUser, auditRow, buildTestApp, createFakeDb } from './helpers.js';

describe('activity routes', () => {
  it('requires authentication', async () => {
    const app = await buildTestApp();
    await app.register(activityRoutes);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(401);
  });

  it('maps audit log rows to ISO strings', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          auditLog: [
            auditRow({ id: 7, userId: 2, action: 'service.create', entity: 'web' }),
            auditRow({ id: 8, userId: null, action: 'backup.completed', entity: 'pg' }),
          ],
        },
      }),
    });
    await app.register(activityRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 7, userId: 2, action: 'service.create', entity: 'web', ts: '2026-01-01T00:00:00.000Z' },
      { id: 8, userId: null, action: 'backup.completed', entity: 'pg', ts: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('filters rows server-side by ?entity=', async () => {
    const findMany = vi.fn(() => [
      auditRow({ id: 7, userId: 2, action: 'service.create', entity: 'web' }),
    ]);
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { auditLog: findMany } }),
    });
    await app.register(activityRoutes);
    const res = await app.inject({ method: 'GET', url: '/?entity=web', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 7, userId: 2, action: 'service.create', entity: 'web', ts: '2026-01-01T00:00:00.000Z' },
    ]);
    // the where clause pins the audit row entity to the query param
    const where = findMany.mock.calls[0]![0]!.where as { queryChunks?: unknown[] };
    expect(where).toBeDefined();
    const values = (where.queryChunks ?? []).map((c) => (c as { value?: unknown })?.value ?? c);
    expect(values).toContain('web');
  });

  it('returns an empty list when there is no activity', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(activityRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
