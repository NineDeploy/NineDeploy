import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentRoutes, databasesRoutes } from '../src/modules/databases.js';
import { asUser, attachmentRow, buildTestApp, createFakeDb, dbRow, svcRow } from './helpers.js';

const engineMocks = vi.hoisted(() => ({
  startDatabase: vi.fn(async (_d: unknown, log: (l: string) => void) => { log('starting'); }),
  stopDatabase: vi.fn(async (_d: unknown, log: (l: string) => void) => { log('stopping'); }),
  connectionString: vi.fn(() => 'postgres://conn'),
  defaultPort: vi.fn((_engine: string) => 5432),
}));

// Partial ENGINES: `mysql` is a valid schema enum value but intentionally
// missing here so the "Unknown engine" branch of the create route is reachable.
vi.mock('../src/engine/database.js', () => ({
  ENGINES: {
    postgres: { username: () => 'nine', dbName: () => 'app' },
    redis: { username: () => undefined, dbName: () => undefined },
  },
  startDatabase: engineMocks.startDatabase,
  stopDatabase: engineMocks.stopDatabase,
  connectionString: engineMocks.connectionString,
  defaultPort: engineMocks.defaultPort,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('databases routes', () => {
  it('lists databases', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          databases: [
            dbRow({ id: 1, status: 'running' }),
            dbRow({ id: 2, status: 'stopped', engine: 'redis' }),
          ],
        },
      }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows[0]).toMatchObject({ id: 1, host: 'nd-db-pg', port: 5432, username: 'nine', database: 'app', connectionString: 'postgres://conn' });
    expect(rows[1]).toMatchObject({ id: 2, status: 'stopped', connectionString: null, username: null, database: null });
  });

  it('creates and starts a database', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: { databases: [dbRow({ id: 5, status: 'creating' })] },
        findFirst: { databases: dbRow({ id: 5, status: 'running' }) },
      }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'My DB', engine: 'postgres', version: '16' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 5, slug: 'pg', status: 'running' });
    expect(engineMocks.startDatabase).toHaveBeenCalled();
    expect(engineMocks.defaultPort).toHaveBeenCalledWith('postgres');
  });

  it('rejects an unknown engine', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'x', engine: 'mysql' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Unknown engine');
  });

  it('returns 400 when the insert fails', async () => {
    const app = await buildTestApp({ db: createFakeDb({ insert: { databases: [] } }) });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'x', engine: 'postgres' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('marks the database errored when startup fails', async () => {
    engineMocks.startDatabase.mockRejectedValueOnce(new Error('oom'));
    const app = await buildTestApp({
      db: createFakeDb({ insert: { databases: [dbRow({ id: 5 })] } }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'x', engine: 'postgres' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Failed to start database: oom');
  });

  it('formats non-Error startup failures', async () => {
    engineMocks.startDatabase.mockRejectedValueOnce('boom');
    const app = await buildTestApp({
      db: createFakeDb({ insert: { databases: [dbRow({ id: 5 })] } }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'x', engine: 'postgres' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Failed to start database: boom');
  });

  it('creates a redis database with nullable username and dbName', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: { databases: [dbRow({ id: 5, engine: 'redis', status: 'creating' })] },
        findFirst: { databases: dbRow({ id: 5, engine: 'redis', status: 'running' }) },
      }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'cache', engine: 'redis' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 5, engine: 'redis', username: null, database: null });
  });

  it('gets a database by id', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { databases: dbRow({ id: 7 }) } }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({ method: 'GET', url: '/7', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 7 });
  });

  it('returns 404 for a missing database', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(databasesRoutes);
    const res = await app.inject({ method: 'GET', url: '/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('deletes a database and its dependents', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { databases: dbRow({ id: 7 }) } }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/7', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(engineMocks.stopDatabase).toHaveBeenCalled();
  });

  it('returns 404 when deleting a missing database', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(databasesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('applies limits and restarts a running database', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { databases: dbRow({ id: 7, status: 'running' }) },
        update: { databases: [dbRow({ id: 7, status: 'running', cpuShares: 512, memLimitMb: 1024 })] },
      }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/7/limits',
      headers: asUser(),
      payload: { cpuShares: 512, memLimitMb: 1024 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cpuShares: 512, memLimitMb: 1024 });
    expect(engineMocks.stopDatabase).toHaveBeenCalled();
    expect(engineMocks.startDatabase).toHaveBeenCalled();
  });

  it('does not restart a non-running database on limit changes', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { databases: dbRow({ id: 7, status: 'stopped' }) },
        update: { databases: [dbRow({ id: 7, status: 'stopped', cpuShares: 128, memLimitMb: 0 })] },
      }),
    });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/7/limits',
      headers: asUser(),
      payload: { cpuShares: 128 },
    });
    expect(res.statusCode).toBe(200);
    expect(engineMocks.stopDatabase).not.toHaveBeenCalled();
  });

  it('returns 404 when updating limits on a missing database', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(databasesRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/99/limits',
      headers: asUser(),
      payload: { cpuShares: 128 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('attachment routes', () => {
  it('lists attachments with resolved databases', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          databaseAttachments: [
            attachmentRow({ id: 1, databaseId: 2 }),
            attachmentRow({ id: 2, databaseId: 99 }),
          ],
        },
        // First lookup (databaseId 2) resolves; second (databaseId 99) is missing.
        findFirst: {
          databases: (() => {
            let n = 0;
            return () => (n++ === 0 ? dbRow({ id: 2, name: 'pg', engine: 'postgres' }) : undefined);
          })(),
        },
      }),
    });
    await app.register(attachmentRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/attachments', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows[0]).toMatchObject({ id: 1, databaseId: 2, database: { name: 'pg', engine: 'postgres', status: 'running' } });
    expect(rows[1]).toMatchObject({ id: 2, databaseId: 99, database: null });
  });

  it('requires a databaseId when attaching', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(attachmentRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/attachments', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an attach request without a body', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(attachmentRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/attachments', headers: asUser() });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the service is missing', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(attachmentRoutes);
    const res = await app.inject({
      method: 'POST', url: '/99/attachments', headers: asUser(), payload: { databaseId: 2 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Service not found');
  });

  it('returns 404 when the service or database is missing', async () => {
    const app = await buildTestApp({ db: createFakeDb({ findFirst: { services: svcRow() } }) });
    await app.register(attachmentRoutes);
    const noDb = await app.inject({
      method: 'POST', url: '/1/attachments', headers: asUser(), payload: { databaseId: 2 },
    });
    expect(noDb.statusCode).toBe(404);
    expect(noDb.json().error.message).toBe('Database not found');
  });

  it('attaches a database with the default env alias', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow(), databases: dbRow({ id: 2, engine: 'postgres' }) },
        insert: { database_attachments: [attachmentRow({ id: 9, databaseId: 2, envAlias: 'DATABASE_URL' })] },
      }),
    });
    await app.register(attachmentRoutes);
    const res = await app.inject({
      method: 'POST', url: '/1/attachments', headers: asUser(), payload: { databaseId: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 9, databaseId: 2, envAlias: 'DATABASE_URL' });
  });

  it('uses REDIS_URL for redis and a custom alias when provided', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow(), databases: dbRow({ id: 2, engine: 'redis' }) },
        insert: { database_attachments: [attachmentRow({ id: 9, databaseId: 2, envAlias: 'REDIS_URL' })] },
      }),
    });
    await app.register(attachmentRoutes);
    const res = await app.inject({
      method: 'POST', url: '/1/attachments', headers: asUser(), payload: { databaseId: 2, envAlias: '  CACHE_URL  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ envAlias: 'CACHE_URL' });
  });

  it('defaults the redis alias to REDIS_URL', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow(), databases: dbRow({ id: 2, engine: 'redis' }) },
        insert: { database_attachments: [attachmentRow({ id: 9, databaseId: 2, envAlias: 'REDIS_URL' })] },
      }),
    });
    await app.register(attachmentRoutes);
    const res = await app.inject({
      method: 'POST', url: '/1/attachments', headers: asUser(), payload: { databaseId: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ envAlias: 'REDIS_URL' });
  });

  it('returns 400 when the attachment already exists', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow(), databases: dbRow() },
        insert: { database_attachments: () => { throw new Error('UNIQUE'); } },
      }),
    });
    await app.register(attachmentRoutes);
    const res = await app.inject({
      method: 'POST', url: '/1/attachments', headers: asUser(), payload: { databaseId: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Already attached');
  });

  it('detaches a database', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(attachmentRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1/attachments/5', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
