import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployments } from '@ninedeploy/db';

const pipelineMock = vi.hoisted(() => ({
  runDeployment: vi.fn(async () => undefined),
}));

vi.mock('../../src/engine/pipeline.js', () => pipelineMock);

const configMock = vi.hoisted(() => ({ config: { deployConcurrency: 1 } }));
vi.mock('../../src/config.js', () => configMock);

const workerPlugin = (await import('../../src/plugins/worker.js')).default;

const POLL_MS = 2000;

/** A controllable promise for gating worker runs. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  // The claim query runs notInArray subqueries and per-partition joins
  // through db.select too; all paths share this builder. Only outer calls
  // (cols = { id }) are counted by `outerSelect`; both query shapes are
  // awaitable (thenable) like drizzle builders.
  const outerSelect = vi.fn();
  const select = vi.fn((cols: unknown) => {
    const isOuter = cols !== undefined && 'id' in (cols as Record<string, unknown>);
    if (isOuter) outerSelect();
    const rows = isOuter ? opts.queued : (opts.building ?? []);
    const self: Record<string, unknown> = {
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mirrors drizzle query builders.
      then: (ok: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        // Outer (candidate) queries resolve via selectImpl so tests can
        // simulate per-call results and failures; inner queries resolve rows.
        (isOuter && opts.selectImpl ? Promise.resolve().then(opts.selectImpl) : Promise.resolve(rows)).then(ok, rej),
    };
    self.from = vi.fn(() => self);
    self.innerJoin = vi.fn(() => self);
    self.where = vi.fn(() => self);
    self.orderBy = vi.fn(() => self);
    self.limit = vi.fn(opts.selectImpl ?? (async () => rows));
    return self;
  });
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
  return { db: { select, update } as never, select, outerSelect, update, updates };
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

  it('counts local builds in the null-server partition', async () => {
    vi.useFakeTimers();
    const { db, updates } = makeDb({
      queued: [],
      building: [{ serverId: null }],
    });
    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(updates.find((u) => u.status === 'building')).toBeUndefined();
    await app.close();
  });

  it('partitions concurrency by target server', async () => {
    vi.useFakeTimers();
    // Partition "1" already runs its full budget (1 building row on serverId 1);
    // the local partition (0) still has room, so its queued row is claimed.
    const { db, updates } = makeDb({
      queued: [{ id: 5, serverId: null }],
      building: [{ serverId: 1 }],
    });
    pipelineMock.runDeployment.mockResolvedValue(undefined);

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    const claim = updates.find((u) => u.status === 'building');
    expect(claim).toBeDefined();
    expect(pipelineMock.runDeployment).toHaveBeenCalledWith(db, 5);
    await app.close();
  });

  it('starves a partition that exhausted its slots', async () => {
    vi.useFakeTimers();
    // Server 1 is at capacity AND the only candidate lives on server 1.
    const { db, updates } = makeDb({
      queued: [{ id: 5, serverId: 1 }],
      building: [{ serverId: 1 }],
    });
    pipelineMock.runDeployment.mockResolvedValue(undefined);

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(updates.find((u) => u.status === 'building')).toBeUndefined();
    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
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
    const { db, outerSelect } = makeDb({ queued: [] });
    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    // One outer claim query per tick (the subquery does not count).
    expect(outerSelect).toHaveBeenCalledTimes(2);
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

  it('runs multiple concurrency slots in parallel', async () => {
    vi.useFakeTimers();
    configMock.config.deployConcurrency = 2;
    // Each slot's claim query sees a different queued deployment (outer calls
    // only — the notInArray subquery reuses db.select without the {id} cols).
    let outerCalls = 0;
    const { db } = makeDb({
      queued: [],
      selectImpl: async () => {
        outerCalls++;
        return outerCalls <= 2 ? [{ id: outerCalls }] : [];
      },
    });
    // Both runs stay in flight until the test releases them.
    const gate1 = deferred();
    const gate2 = deferred();
    pipelineMock.runDeployment.mockReturnValueOnce(gate1.promise as never).mockReturnValueOnce(gate2.promise as never);

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS + 1000);
    expect(pipelineMock.runDeployment).toHaveBeenCalledTimes(2);
    expect(pipelineMock.runDeployment).toHaveBeenCalledWith(db, 1);
    expect(pipelineMock.runDeployment).toHaveBeenCalledWith(db, 2);

    // Releasing both lets the slots settle and close cleanly.
    gate1.resolve();
    gate2.resolve();
    configMock.config.deployConcurrency = 1;
    await app.close();
  });

  it('stop() waits for all in-flight slots and re-polls none', async () => {
    vi.useFakeTimers();
    configMock.config.deployConcurrency = 2;
    let outerCalls = 0;
    const { db } = makeDb({
      queued: [],
      selectImpl: async () => {
        outerCalls++;
        return outerCalls <= 2 ? [{ id: outerCalls }] : [];
      },
    });
    const gate1 = deferred();
    const gate2 = deferred();
    pipelineMock.runDeployment.mockReturnValueOnce(gate1.promise as never).mockReturnValueOnce(gate2.promise as never);

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS + 1000);
    expect(pipelineMock.runDeployment).toHaveBeenCalledTimes(2);

    // stop() resolves once BOTH in-flight runs settle (no grace needed).
    const stopping = app.worker.stop();
    gate1.resolve();
    gate2.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(pipelineMock.runDeployment).toHaveBeenCalledTimes(2);
    configMock.config.deployConcurrency = 1;
  });

  it('stop() gives up after the grace period when runs hang', async () => {
    vi.useFakeTimers();
    configMock.config.deployConcurrency = 1;
    const { db } = makeDb({ queued: [{ id: 4 }] });
    pipelineMock.runDeployment.mockReturnValue(new Promise(() => {}) as never);

    const app = await buildApp(db);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const stopping = app.worker.stop();
    // Hit the 60s backstop; the unref'd grace timer settles the race.
    await vi.advanceTimersByTimeAsync(61_000);
    await stopping;
    expect(pipelineMock.runDeployment).toHaveBeenCalledTimes(1);
  });

  it('does not reschedule after close while a tick is in flight', async () => {
    vi.useFakeTimers();
    let resolveQueued: (rows: Array<{ id: number }>) => void = () => undefined;
    const pending = new Promise<Array<{ id: number }>>((r) => {
      resolveQueued = r;
    });
    const { db, outerSelect } = makeDb({ queued: [], selectImpl: () => pending });
    const app = await buildApp(db);

    vi.advanceTimersByTime(POLL_MS); // first tick starts, suspends on the pending query
    await app.close(); // running = false
    resolveQueued([]);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(outerSelect).toHaveBeenCalledTimes(1); // no further polls scheduled
    expect(pipelineMock.runDeployment).not.toHaveBeenCalled();
  });
});
