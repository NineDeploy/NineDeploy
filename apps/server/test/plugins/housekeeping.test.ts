import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, notificationLog } from '@ninedeploy/db';

const logsMock = vi.hoisted(() => ({ pruneOldLogs: vi.fn(() => 0) }));
const execMock = vi.hoisted(() => ({
  run: vi.fn(async (_c: string, _a: unknown[], _o: unknown, sink?: (l: string) => void) => {
    sink?.('');
  }),
}));
const autoPruneMock = vi.hoisted(() => ({
  getAutoPruneStatus: vi.fn(async () => ({
    enabled: true,
    thresholdPercent: 85,
    diskUsedPercent: 90,
  })),
  executeAutoPrune: vi.fn(async () => ({ ok: true, freedBytes: 100 })),
}));

vi.mock('../../src/engine/logs.js', () => ({ logBus: new (class extends EventTarget {})(), pruneOldLogs: logsMock.pruneOldLogs }));
vi.mock('../../src/lib/exec.js', () => ({ run: execMock.run }));
vi.mock('../../src/engine/autoPrune.js', () => ({
  getAutoPruneStatus: autoPruneMock.getAutoPruneStatus,
  executeAutoPrune: autoPruneMock.executeAutoPrune,
}));

const housekeepingPlugin = (await import('../../src/plugins/housekeeping.js')).default;

function makeDb() {
  const deleted: Array<{ table: unknown }> = [];
  const del = vi.fn((table: unknown) => {
    deleted.push({ table });
    return { where: vi.fn(async () => undefined) };
  });
  return { db: { delete: del } as never, deleted };
}

async function buildApp(db: ReturnType<typeof makeDb>['db']) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(housekeepingPlugin);
  return app;
}

describe('housekeeping plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logsMock.pruneOldLogs.mockClear();
    autoPruneMock.executeAutoPrune.mockClear();
    autoPruneMock.getAutoPruneStatus.mockResolvedValue({
      enabled: true,
      thresholdPercent: 85,
      diskUsedPercent: 90,
    } as never);
  });
  afterEach(async () => {
    vi.useRealTimers();
  });

  it('prunes old logs and deletes stale audit/notification rows on each tick', async () => {
    const { db, deleted } = makeDb();
    const app = await buildApp(db);

    // The first tick fires ~60s after boot.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(logsMock.pruneOldLogs).toHaveBeenCalledTimes(1);
    const tables = deleted.map((d) => d.table);
    expect(tables).toContain(auditLog);
    expect(tables).toContain(notificationLog);
    // Dangling Docker images are pruned each tick too.
    expect(execMock.run).toHaveBeenCalledWith('docker', ['image', 'prune', '-f'], {}, expect.any(Function));
    // Auto-prune was triggered because 90% >= 85%
    expect(autoPruneMock.executeAutoPrune).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('skips auto-prune when disk percent is below threshold', async () => {
    autoPruneMock.getAutoPruneStatus.mockResolvedValueOnce({
      enabled: true,
      thresholdPercent: 85,
      diskUsedPercent: 40,
    } as never);
    const { db } = makeDb();
    const app = await buildApp(db);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(autoPruneMock.executeAutoPrune).not.toHaveBeenCalled();
    await app.close();
  });

  it('logs and continues when a retention delete fails', async () => {
    const del = vi.fn(() => ({ where: vi.fn(async () => Promise.reject(new Error('db locked'))) }));
    const app = await buildApp({ delete: del } as never);
    const errorSpy = vi.spyOn(app.log, 'error');

    await vi.advanceTimersByTimeAsync(60_000);

    expect(errorSpy).toHaveBeenCalledWith({ err: expect.objectContaining({ message: 'db locked' }) }, 'housekeeping failed');
    // Still reschedules the next tick.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(logsMock.pruneOldLogs).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('stops scheduling after close', async () => {
    const { db } = makeDb();
    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(60_000);
    await app.close();

    const callsBefore = logsMock.pruneOldLogs.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 * 24);
    expect(logsMock.pruneOldLogs.mock.calls.length).toBe(callsBefore);
  });

  it('does not reschedule when close lands while a tick is still in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const del = vi.fn(() => ({ where: vi.fn(() => gate) }));
    const app = await buildApp({ delete: del } as never);

    // Start the first tick; it hangs on the db delete.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logsMock.pruneOldLogs).toHaveBeenCalledTimes(1);

    // Close while the tick is in flight: running flips to false before the
    // finally block runs, so the next tick must not be scheduled.
    await app.close();
    release();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(logsMock.pruneOldLogs).toHaveBeenCalledTimes(1);
  });

  it('absorbs a failing docker image prune without breaking the tick', async () => {
    execMock.run.mockRejectedValueOnce(new Error('docker unavailable'));
    const { db } = makeDb();
    const app = await buildApp(db);

    await vi.advanceTimersByTimeAsync(60_000);

    // The prune rejection is caught (fire-and-forget); the rest of the tick still ran.
    expect(logsMock.pruneOldLogs).toHaveBeenCalledTimes(1);
    expect(execMock.run).toHaveBeenCalledWith('docker', ['image', 'prune', '-f'], {}, expect.any(Function));
    await app.close();
  });
});
