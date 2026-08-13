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
    execMocks.capture.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'volume') return Promise.resolve('nd-svc-web\nnd-db-pg\nnd-svc-orphan\nnd-db-lonely\n');
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
      { name: 'nd-svc-web', sizeBytes: 2048, owner: { kind: 'service', name: 'Web' } },
      { name: 'nd-db-pg', sizeBytes: 2048, owner: { kind: 'database', name: 'PG', engine: 'postgres' } },
      { name: 'nd-svc-orphan', sizeBytes: 2048, owner: null },
      { name: 'nd-db-lonely', sizeBytes: 2048, owner: null },
    ]);
  });

  it('handles unparseable sizes as zero', async () => {
    execMocks.capture.mockImplementation((cmd: string, args: string[]) => {
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
    execMocks.capture.mockImplementation((cmd: string, args: string[]) => {
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

  it('refuses to delete an unmanaged volume', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(volumeRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/other-volume', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: 'not a managed volume' });
    expect(dbEngineMocks.removeVolume).not.toHaveBeenCalled();
  });
});
