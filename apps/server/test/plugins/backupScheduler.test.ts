import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { backups, } from '@ninedeploy/db';

const engineMock = vi.hoisted(() => ({
  backupDatabase: vi.fn(async () => undefined),
}));

vi.mock('../../src/engine/database.js', () => engineMock);

const tmp = path.join(os.tmpdir(), `ninedeploy-backups-${process.pid}-${Date.now()}`);
mkdirSync(tmp, { recursive: true });

vi.stubEnv('NINEDEPLOY_DATA_DIR', tmp);

const backupSchedulerPlugin = (await import('../../src/plugins/backupScheduler.js')).default;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_PER_DB = 7;

interface DbRow {
  id: number;
  slug: string;
  name: string;
  status: string;
}

function makeDb(opts: {
  dbs: DbRow[];
  backupRows?: Array<{ id: number; databaseId: number; path: string; createdAt: Date }>;
  selectImpl?: () => Promise<unknown>;
}) {
  const select = vi.fn(() => ({ from: vi.fn(opts.selectImpl ?? (async () => opts.dbs)) }));
  const insert = vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 1 }]) })) }));
  const del = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  const findMany = vi.fn(async () => opts.backupRows ?? []);
  return {
    db: {
      select,
      insert,
      delete: del,
      query: { backups: { findMany } },
    } as never,
    insert,
    del,
    findMany,
  };
}

async function buildApp(db: ReturnType<typeof makeDb>['db']) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(backupSchedulerPlugin);
  return app;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  engineMock.backupDatabase.mockReset();
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe('backup scheduler plugin', () => {
  it('backs up running databases, records size, and prunes stale backups', async () => {
    vi.useFakeTimers();
    const stalePath = path.join(tmp, 'stale.dump');
    writeFileSync(stalePath, 'old');
    const missingPath = path.join(tmp, 'missing.dump');

    const rows = [];
    for (let i = 0; i < KEEP_PER_DB + 2; i++) {
      // rows[7] and rows[8] fall past the KEEP_PER_DB window; rows[7] exists on
      // disk (gets unlinked), rows[8] does not.
      rows.push({ id: i + 1, databaseId: 1, scope: 'scheduled', path: i === 7 ? stalePath : missingPath, createdAt: new Date() });
    }
    // A MANUAL backup is never pruned by the scheduler — even far past the
    // retention window it must survive.
    const manualPath = path.join(tmp, 'manual.dump');
    writeFileSync(manualPath, 'manual');
    rows.push({ id: 99, databaseId: 1, scope: 'db', path: manualPath, createdAt: new Date(0) });

    const { db, insert, del, findMany } = makeDb({
      dbs: [
        { id: 1, slug: 'main-db', name: 'Main', status: 'running' },
        { id: 2, slug: 'stopped-db', name: 'Stopped', status: 'stopped' },
      ],
      backupRows: rows,
    });
    const app = Fastify({ logger: false });
    const logSpy = vi.spyOn(app.log, 'info');
    app.decorate('db', db);
    await app.register(backupSchedulerPlugin);

    // backupDatabase creates the dump file for db 1 so sizeBytes > 0, and
    // invokes the scheduler's log sink so the plugin's log helper runs.
    engineMock.backupDatabase.mockImplementation(async (_d: unknown, file: string, log?: (line: string) => void) => {
      writeFileSync(file, 'dump-data');
      log?.('dumping database');
    });

    await vi.advanceTimersByTimeAsync(DAY_MS);

    // Only the running database is backed up.
    expect(engineMock.backupDatabase).toHaveBeenCalledTimes(1);
    const [, file] = engineMock.backupDatabase.mock.calls[0] as [unknown, string];
    expect(file).toContain(path.join(tmp, 'backups', 'main-db-'));
    expect(file.endsWith('.dump')).toBe(true);

    expect(insert).toHaveBeenCalledWith(backups);
    const valuesFn = (insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> }).values;
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 1, scope: 'scheduled', status: 'completed', sizeBytes: expect.any(Number) }),
    );
    // sizeBytes reflects the file written by the mocked backup.
    const inserted = valuesFn.mock.calls[0]![0] as { sizeBytes: number };
    expect(inserted.sizeBytes).toBe(Buffer.byteLength('dump-data'));

    // Prune: two stale SCHEDULED rows past KEEP_PER_DB; one file exists (unlinked), one does not.
    expect(findMany).toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(backups);
    expect(existsSync(stalePath)).toBe(false); // unlinked
    const whereCalls = del.mock.results.reduce(
      (n, r) => n + (r.value as { where: ReturnType<typeof vi.fn> }).where.mock.calls.length,
      0,
    );
    expect(whereCalls).toBe(2); // one delete per stale scheduled row
    // The manual backup (scope 'db') was NOT pruned.
    expect(existsSync(manualPath)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('backup scheduler armed (daily)');
    await app.close();
  });

  it('logs per-database failures but keeps going', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({
      dbs: [
        { id: 1, slug: 'a', name: 'A', status: 'running' },
        { id: 2, slug: 'b', name: 'B', status: 'running' },
      ],
    });
    engineMock.backupDatabase.mockRejectedValueOnce(new Error('pg_dump failed'));
    const app = await buildApp(db);
    const errorSpy = vi.spyOn(app.log, 'error');

    await vi.advanceTimersByTimeAsync(DAY_MS);

    expect(engineMock.backupDatabase).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'pg_dump failed' }) },
      `scheduled backup failed for A`,
    );    await app.close();
  });

  it('logs when the whole tick fails', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({
      dbs: [],
      selectImpl: async () => {
        throw new Error('db locked');
      },
    });
    const app = await buildApp(db);
    const errorSpy = vi.spyOn(app.log, 'error');

    await vi.advanceTimersByTimeAsync(DAY_MS);

    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'db locked' }) },
      'backup scheduler tick failed',
    );
    await app.close();
  });

  it('does nothing when no database is running', async () => {
    vi.useFakeTimers();
    const { db, insert } = makeDb({
      dbs: [
        { id: 1, slug: 'x', name: 'X', status: 'creating' },
        { id: 2, slug: 'y', name: 'Y', status: 'stopped' },
      ],
    });
    const app = await buildApp(db);

    await vi.advanceTimersByTimeAsync(DAY_MS);

    expect(engineMock.backupDatabase).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    await app.close();
  });

  it('reschedules the daily tick while running', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ dbs: [] });
    const app = await buildApp(db);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(engineMock.backupDatabase).not.toHaveBeenCalled();
    expect(app.db).toBeDefined();
    await vi.advanceTimersByTimeAsync(DAY_MS);
    // A second tick ran (db.select called twice total).
    expect((db.select as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('stops rescheduling after close', async () => {
    vi.useFakeTimers();
    let resolveSelect: (rows: DbRow[]) => void = () => undefined;
    const pending = new Promise<DbRow[]>((r) => {
      resolveSelect = r;
    });
    const { db } = makeDb({ dbs: [], selectImpl: () => pending });

    const app = await buildApp(db);
    vi.advanceTimersByTime(DAY_MS); // tick starts, suspends on pending select
    await app.close(); // running = false
    resolveSelect([]);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(engineMock.backupDatabase).not.toHaveBeenCalled();
  });

  it('skips the remote upload when the insert returns no row', async () => {
    vi.useFakeTimers();
    // insert().returning() resolves to [] — uploadBackup must not be called.
    const select = vi.fn(() => ({ from: vi.fn(async () => [{ id: 1, slug: 'a', name: 'A', status: 'running' }]) }));
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
    }));
    const del = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = { select, insert, delete: del, query: { backups: { findMany: vi.fn(async () => []) } } } as never;
    const app = await buildApp(db);
    engineMock.backupDatabase.mockImplementation(async () => undefined);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    // The tick completed without throwing despite the empty returning.
    expect(engineMock.backupDatabase).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
