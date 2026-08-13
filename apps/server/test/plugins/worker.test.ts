import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployments } from '@ninedeploy/db';

const pipelineMock = vi.hoisted(() => ({
  runDeployment: vi.fn(async () => undefined),
}));

vi.mock('../../src/engine/pipeline.js', () => pipelineMock);

const workerPlugin = (await import('../../src/plugins/worker.js')).default;

const POLL_MS = 2000;

interface RecordedUpdate {
  table: unknown;
  status: unknown;
  whereArgs?: unknown;
}

function makeDb(opts: {
  queued: Array<{ id: number }>;
  selectImpl?: () => Promise<unknown>;
  /** rowsAffected returned by the queued→building claim update (default 1 = won the claim). */
  claimRowsAffected?: number;
  /** Override the entire claim update result (e.g. undefined to simulate a missing payload). */
  claimResult?: unknown;
}) {
  const updates: RecordedUpdate[] = [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(opts.selectImpl ?? (async () => opts.queued)),
        })),
      })),
    })),
  }));
  const update = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (whereArgs?: unknown) => {
        updates.push({ table, status: values.status, whereArgs });
        if (values.status === 'building') {
          const result = 'claimResult' in opts ? opts.claimResult : { rowsAffected: opts.claimRowsAffected ?? 1 };
          return Promise.resolve(result);
        }
        return Promise.resolve({ rowsAffected: 1 });
      },
    }),
  }));
  return { db: { select, update } as never, select, update, updates };
}

async function buildApp(db: ReturnType<typeof makeDb>['db']) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(workerPlugin);
  return app;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  pipelineMock.runDeployment.mockReset();
});

describe('worker plugin', () => {
  it('sweeps stale `building` deployments to failed on startup (crash recovery)', async () => {
    const { db, updates } = makeDb({ queued: [] });
    const app = await buildApp(db);
    await app.close();

    const sweep = updates.find((u) => u.status === 'failed');
    expect(sweep).toBeDefined();
    expect(sweep!.table).toBe(deployments);
  });

  it('starts anyway and warns when the startup sweep query fails', async () => {
    vi.useFakeTimers();
    const update = vi.fn((_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () =>
          values.status === 'failed'
            ? Promise.reject(new Error('db locked'))
            : Promise.resolve({ rowsAffected: 1 }),
      }),
    }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })) })),
      })),
    }));
    const app = Fastify({ logger: false });
    app.decorate('db', { select, update });
    const warnSpy = vi.spyOn(app.log, 'warn');
    await app.register(workerPlugin);

    expect(warnSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'db locked' }) },
      'could not sweep stale building deployments',
    );
    await app.close();
  });

  it('claims and runs a queued deployment', async () => {
    vi.useFakeTimers();
    const { db, updates } = makeDb({ queued: [{ id: 5 }] });
    pipelineMock.runDeployment.mockResolvedValue(undefined);

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    // The claim update sets status 'building'.
    const claim = updates.find((u) => u.status === 'building');
    expect(claim).toBeDefined();
    expect(pipelineMock.runDeployment).toHaveBeenCalledWith(db, 5);
    await app.close();
  });

  it('skips a deployment it did not win the claim for (rowsAffected 0)', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ queued: [{ id: 5 }], claimRowsAffected: 0 });

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
    await app.close();
  });

  it('skips a deployment when the claim result has no rowsAffected payload', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ queued: [{ id: 5 }], claimResult: undefined });

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
    await app.close();
  });

  it('does nothing (no claim, no run) when no deployment is queued', async () => {
    vi.useFakeTimers();
    const { db, updates } = makeDb({ queued: [] });
    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(updates.some((u) => u.status === 'building')).toBe(false);
    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
    await app.close();
  });

  it('logs and continues when the pipeline fails', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ queued: [{ id: 3 }] });
    pipelineMock.runDeployment.mockRejectedValueOnce(new Error('build failed'));
    const app = await buildApp(db);
    const errorSpy = vi.spyOn(app.log, 'error');

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'build failed' }) },
      'worker tick failed',
    );
    await app.close();
  });

  it('logs when the claim query itself fails', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({
      queued: [],
      selectImpl: async () => {
        throw new Error('query failed');
      },
    });
    const app = await buildApp(db);
    const errorSpy = vi.spyOn(app.log, 'error');

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'query failed' }) },
      'worker tick failed',
    );
    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
    await app.close();
  });

  it('polls repeatedly while running', async () => {
    vi.useFakeTimers();
    const { db, select } = makeDb({ queued: [] });
    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    // select is called once per tick (after the startup recovery).
    expect(select).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('stop() clears the timer and settles even when the current run rejects', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ queued: [{ id: 9 }] });
    pipelineMock.runDeployment.mockRejectedValueOnce(new Error('boom'));
    const app = await buildApp(db);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    await expect(app.worker.stop()).resolves.toBeUndefined();
    expect(pipelineMock.runDeployment).toHaveBeenCalledTimes(1);

    // No further polls after stop.
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(pipelineMock.runDeployment).toHaveBeenCalledTimes(1);
  });

  it('guards against ticks after stop (timer already queued)', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ queued: [{ id: 1 }] });
    pipelineMock.runDeployment.mockResolvedValue(undefined);
    const app = await buildApp(db);

    // Neutralize clearTimeout so the pending timer still fires after stop().
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    await app.worker.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS); // tick fires while running === false

    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('closes via the onClose hook', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({ queued: [] });
    const app = await buildApp(db);
    await app.close();
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
  });

  it('does not reschedule after close while a tick is in flight', async () => {
    vi.useFakeTimers();
    let resolveQueued: (rows: Array<{ id: number }>) => void = () => undefined;
    const pending = new Promise<Array<{ id: number }>>((r) => {
      resolveQueued = r;
    });
    const { db, select } = makeDb({ queued: [], selectImpl: () => pending });
    const app = await buildApp(db);

    vi.advanceTimersByTime(POLL_MS); // first tick starts, suspends on the pending query
    await app.close(); // running = false
    resolveQueued([]);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(select).toHaveBeenCalledTimes(1); // no further polls scheduled
    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
  });
});
