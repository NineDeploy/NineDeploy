import { describe, expect, it } from 'vitest';
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

  it('returns an empty list when there is no activity', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(activityRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
