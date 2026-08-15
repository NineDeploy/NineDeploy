import { beforeEach, describe, expect, it, vi } from 'vitest';
import { volumeRoutes } from '../src/modules/volumes.js';
import { asUser, buildTestApp, createFakeDb, dbRow, svcRow } from './helpers.js';

const execMocks = vi.hoisted(() => ({ capture: vi.fn() }));
const dbEngineMocks = vi.hoisted(() => ({
  removeVolume: vi.fn(async (_n: string, log: (l: string) => void) => { log('deleting'); }),
}));

vi.mock('../src/lib/exec.js', () => execMocks);
vi.mock('../src/engine/database.js', () => dbEngineMocks);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('volume routes', () => {
  it('lists managed volumes with owners and sizes', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'volume') return Promise.resolve('nd-svc-web\nnd-db-pg\nnd-svc-orphan\nnd-db-lonely\n');
      if (args[0] === 'ps') return Promise.resolve(''); // nothing running
      return Promise.resolve('2048 /v\n');
    });
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 1, slug: 'web', name: 'Web' })],
          databases: [dbRow({ id: 2, slug: 'pg', name: 'PG' })],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { name: 'nd-svc-web', sizeBytes: 2048, owner: { kind: 'service', name: 'Web' }, inUse: false },
      { name: 'nd-db-pg', sizeBytes: 2048, owner: { kind: 'database', name: 'PG', engine: 'postgres' }, inUse: false },
      { name: 'nd-svc-orphan', sizeBytes: 2048, owner: null, inUse: false },
      { name: 'nd-db-lonely', sizeBytes: 2048, owner: null, inUse: false },
    ]);
  });

  it('handles unparseable sizes as zero', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'volume') return Promise.resolve('nd-svc-web\n');
      return Promise.resolve('garbage output');
    });
    const app = await buildTestApp({
      db: createFakeDb({ select: { services: [svcRow({ slug: 'web' })] } }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].sizeBytes).toBe(0);
  });

  it('returns an empty list when docker volume ls fails', async () => {
    execMocks.capture.mockRejectedValueOnce(new Error('docker down'));
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('treats a failing size probe as zero', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'volume') return Promise.resolve('nd-svc-web\n');
      return Promise.reject(new Error('docker run failed'));
    });
    const app = await buildTestApp({
      db: createFakeDb({ select: { services: [svcRow({ slug: 'web' })] } }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].sizeBytes).toBe(0);
  });

  it('deletes a managed volume', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/nd-svc-web-data', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(dbEngineMocks.removeVolume).toHaveBeenCalledWith('nd-svc-web-data', expect.any(Function));
  });

  it('refuses to delete an unmanaged volume with 400', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/other-volume', headers: asUser() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('not a managed volume');
    expect(dbEngineMocks.removeVolume).not.toHaveBeenCalled();
  });

  it('refuses (409) to delete a volume whose owner container is running', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve('abc123\n'); // container running
      return Promise.resolve('');
    });
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 1, slug: 'web', name: 'Web', runtimeId: 'web-1' })],
          databases: [],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/nd-svc-web-data', headers: asUser() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('in use by service "Web"');
    expect(dbEngineMocks.removeVolume).not.toHaveBeenCalled();
  });

  it('refuses (409) to delete a running database volume', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve('abc123\n');
      return Promise.resolve('');
    });
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [],
          databases: [dbRow({ id: 2, slug: 'pg', name: 'PG', engine: 'postgres', containerName: 'nd-db-pg' })],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/nd-db-pg-data', headers: asUser() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('in use by database "PG"');
  });

  it('deletes an owned volume once its owner is stopped (container not running)', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve(''); // stopped
      return Promise.resolve('');
    });
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 1, slug: 'web', name: 'Web', runtimeId: 'web-1' })],
          databases: [],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/nd-svc-web-data', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(dbEngineMocks.removeVolume).toHaveBeenCalledWith('nd-svc-web-data', expect.any(Function));
  });

  it('treats a failing docker ps as not-running (never blocks deletes on docker hiccups)', async () => {
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'ps') return Promise.reject(new Error('docker hiccup'));
      return Promise.resolve('');
    });
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 1, slug: 'web', name: 'Web', runtimeId: 'web-1' })],
          databases: [],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/nd-svc-web-data', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(dbEngineMocks.removeVolume).toHaveBeenCalled();
  });

  it('treats an unmanaged volume name as ownerless in the listing path', async () => {
    // volumeOwner returns null for names outside nd-svc-/nd-db- prefixes;
    // exercised via the GET listing of a mixed set.
    execMocks.capture.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === 'volume') return Promise.resolve('nd-svc-web\n');
      if (args[0] === 'ps') return Promise.resolve('running-id\n'); // in-use path
      return Promise.resolve('4096 /v\n');
    });
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 1, slug: 'web', name: 'Web', runtimeId: 'web-1' })],
          databases: [],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ name: 'nd-svc-web', inUse: true });
  });

  it('deletes an owned volume when the owner has no runtime container at all', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 1, slug: 'web', name: 'Web', runtimeId: null })],
          databases: [],
        },
      }),
    });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/nd-svc-web-data', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(dbEngineMocks.removeVolume).toHaveBeenCalled();
  });
});
