/**
 * G-32 PgBouncer sidecar — lib coverage.
 *
 * `pgbouncer.ts` is the engine behind the three
 * `databases pgbouncer {enable, disable, status}` routes. The
 * surface worth pinning down:
 *  - `pgbouncerContainerName` falls back to `nd-pgb-<slug>`
 *    when the row is not flagged.
 *  - `pooledConnectionString` returns the pgbouncer URL when
 *    the sidecar is enabled, the direct URL otherwise. It
 *    fills missing `username` / `dbName` / `containerName`
 *    with sane defaults so a row that was created before the
 *    pgbouncer columns existed still resolves.
 *  - `enablePgbouncer` is idempotent (re-running on an
 *    already-up sidecar is a no-op), refuses non-postgres
 *    engines and databases without a container name, and
 *    bails when the postgres container is not running yet.
 *  - The pull+ini+userlist+run sequence is wired through
 *    `exec` + `secretFile`, and the row is stamped with the
 *    resolved container name + port on success.
 *  - `disablePgbouncer` skips when the row is not flagged,
 *    tears the container down, clears the row, and reaps
 *    the bind-mounted config files.
 *  - `pgbouncerStatusFor` returns the disabled shape when
 *    the row is not flagged, otherwise queries docker for
 *    the running flag and parses `PGBOUNCER_POOL_MODE` out
 *    of the inspect output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execState,
  cryptoState,
  secretState,
  fsState,
} = vi.hoisted(() => {
  const execState = {
    /** Maps a `tool args-joined` key to the result to return. */
    toolResults: new Map<string, { stdout?: string; throw?: Error }>(),
    /** Recorded docker run args for assertions. */
    runs: [] as Array<{ tool: string; args: string[] }>,
    /** Recorded `capture` calls (for the pull step). */
    captures: [] as Array<{ tool: string; args: string[] }>,
  };
  const cryptoState = {
    /** id → decrypted password. */
    decrypted: new Map<string, string>(),
  };
  const secretState = {
    /** id → written path. */
    written: new Map<string, string>(),
    nextId: 0,
  };
  const fsState = {
    unlinkCalls: [] as string[],
  };
  return { execState, cryptoState, secretState, fsState };
});

vi.mock('../../src/lib/exec.js', () => ({
  capture: vi.fn(async (tool: string, args: string[] = []) => {
    execState.captures.push({ tool, args });
    const key = `${tool} ${args.join(' ')}`;
    const r = execState.toolResults.get(key);
    if (r?.throw) throw r.throw;
    return r?.stdout ?? '';
  }),
  run: vi.fn(async (tool: string, args: string[] = []) => {
    execState.runs.push({ tool, args });
    const key = `${tool} ${args.join(' ')}`;
    const r = execState.toolResults.get(key);
    if (r?.throw) throw r.throw;
  }),
}));

vi.mock('../../src/lib/crypto.js', () => ({
  decrypt: vi.fn((cipher: string) => {
    return cryptoState.decrypted.get(cipher) ?? 'plainpw';
  }),
}));

vi.mock('../../src/lib/secretFile.js', () => ({
  writeSecretFile: vi.fn(async (_ref: string, suffix: string, _body: string) => {
    const id = secretState.nextId++;
    const path = `/tmp/nd-pgb-test-${id}.${suffix}`;
    secretState.written.set(suffix, path);
    return { path };
  }),
}));

vi.mock('../../src/engine/proxy.js', () => ({
  NETWORK: 'nd-net',
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    unlink: vi.fn(async (p: string) => {
      fsState.unlinkCalls.push(p);
    }),
  };
});

import {
  enablePgbouncer,
  disablePgbouncer,
  pgbouncerContainerName,
  pgbouncerStatusFor,
  pooledConnectionString,
} from '../../src/lib/pgbouncer.js';
import { createFakeDb } from '../helpers.js';

interface DbRow {
  id: number;
  name: string;
  slug: string;
  engine: string;
  containerName: string | null;
  internalHost: string | null;
  internalPort: number | null;
  dbName: string | null;
  username: string | null;
  passwordEncrypted: string;
  pgbouncerEnabled: boolean;
  pgbouncerContainerName: string | null;
  pgbouncerPort: number | null;
}

function buildDb(overrides: Partial<DbRow> = {}): DbRow {
  return {
    id: 1,
    name: 'mydb',
    slug: 'mydb',
    engine: 'postgres',
    containerName: 'nd-pg-mydb',
    internalHost: null,
    internalPort: 5432,
    dbName: 'app',
    username: 'nine',
    passwordEncrypted: 'cipher::pw',
    pgbouncerEnabled: false,
    pgbouncerContainerName: null,
    pgbouncerPort: null,
    ...overrides,
  };
}

const dbState = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  database: { id: 1 } as DbRow,
}));

vi.mock('@ninedeploy/db', () => ({
  databases: { _: { name: 'databases' } },
  // biome-ignore lint/suspicious/noExplicitAny: fake — tests cast through createFakeDb
}));

const db = createFakeDb({
  update: {
    databases: (set: Record<string, unknown>) => {
      dbState.updates.push({ table: 'databases', set });
      return [{ id: 1, ...set }];
    },
  },
});

beforeEach(() => {
  execState.toolResults.clear();
  execState.runs.length = 0;
  execState.captures.length = 0;
  cryptoState.decrypted.clear();
  cryptoState.decrypted.set('cipher::pw', 'plainpw');
  secretState.written.clear();
  secretState.nextId = 0;
  fsState.unlinkCalls.length = 0;
  dbState.updates.length = 0;
  dbState.database = { id: 1 } as DbRow;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pgbouncerContainerName', () => {
  it('returns the explicit column when set', () => {
    expect(pgbouncerContainerName(buildDb({ pgbouncerContainerName: 'nd-pgb-custom' }))).toBe('nd-pgb-custom');
  });

  it('falls back to nd-pgb-<slug> when the column is null', () => {
    expect(pgbouncerContainerName(buildDb({ pgbouncerContainerName: null, slug: 'orders' }))).toBe('nd-pgb-orders');
  });
});

describe('pooledConnectionString', () => {
  it('returns the pgbouncer URL when the sidecar is enabled', () => {
    const s = pooledConnectionString(
      buildDb({
        pgbouncerEnabled: true,
        pgbouncerContainerName: 'nd-pgb-mydb',
        pgbouncerPort: 6432,
      }),
    );
    expect(s).toBe('postgres://nine:plainpw@nd-pgb-mydb:6432/app');
  });

  it('falls back to the direct URL when pgbouncerEnabled is false', () => {
    const s = pooledConnectionString(buildDb());
    expect(s).toBe('postgres://nine:plainpw@nd-pg-mydb:5432/app');
  });

  it('falls back to the direct URL when the container name is missing', () => {
    const s = pooledConnectionString(buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: null }));
    expect(s).toBe('postgres://nine:plainpw@nd-pg-mydb:5432/app');
  });

  it('uses default username / dbName / port / host when columns are missing', () => {
    const s = pooledConnectionString(
      buildDb({
        pgbouncerEnabled: false,
        pgbouncerContainerName: null,
        username: null,
        dbName: null,
        internalPort: null,
        containerName: null,
        internalHost: 'pg.internal',
      }),
    );
    // Direct path: defaults resolve to nine / app / 5432 / pg.internal.
    expect(s).toBe('postgres://nine:plainpw@pg.internal:5432/app');
  });

  it('uses the default pgbouncer port when none is set', () => {
    const s = pooledConnectionString(
      buildDb({
        pgbouncerEnabled: true,
        pgbouncerContainerName: 'nd-pgb-mydb',
        pgbouncerPort: null,
      }),
    );
    expect(s).toBe('postgres://nine:plainpw@nd-pgb-mydb:6432/app');
  });

  it('encodes the password and username when special characters are present', () => {
    cryptoState.decrypted.set('cipher::pw', 'p@ss/wo:rd!');
    // `encodeURIComponent` does NOT encode `!` (it's a valid URI character);
    // the `:` and `/` get encoded as `%3A` / `%2F`.
    const s = pooledConnectionString(buildDb());
    expect(s).toBe('postgres://nine:p%40ss%2Fwo%3Ard!@nd-pg-mydb:5432/app');
  });
});

describe('enablePgbouncer', () => {
  it('rejects non-postgres engines', async () => {
    await expect(
      enablePgbouncer(db, buildDb({ engine: 'mysql' }), () => undefined),
    ).rejects.toThrow(/only supported for the postgres engine/);
  });

  it('rejects when the row has no container name', async () => {
    await expect(
      enablePgbouncer(db, buildDb({ containerName: null }), () => undefined),
    ).rejects.toThrow(/no container name/);
  });

  it('is a no-op when the sidecar is already running', async () => {
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pgb-mydb', { stdout: 'true\n' });
    await enablePgbouncer(
      db,
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
      () => undefined,
    );
    // Pull + run + update must not happen.
    expect(execState.runs).toEqual([]);
    expect(dbState.updates).toEqual([]);
  });

  it('continues to enable when the row is flagged but the container is down', async () => {
    // First inspect says not running; we then bring it up via run, then
    // re-inspect (for the log line is not called — pgbouncer is "running" only
    // if the row is flagged AND the inspect returns true). Here the row is
    // flagged but inspect says false, so the code falls through to setup.
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pg-mydb', { stdout: 'true\n' });
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pgb-mydb', { stdout: 'false\n' });
    await enablePgbouncer(
      db,
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
      () => undefined,
    );
    // A run happened (we re-created the container) and a row update followed.
    expect(execState.runs.some((r) => r.args.includes('run'))).toBe(true);
    expect(dbState.updates.length).toBeGreaterThan(0);
  });

  it('refuses when the postgres container is not running', async () => {
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pg-mydb', { stdout: 'false\n' });
    await expect(
      enablePgbouncer(db, buildDb(), () => undefined),
    ).rejects.toThrow(/Postgres container.*is not running/);
  });

  it('pulls the image, writes config, launches the sidecar, and stamps the row', async () => {
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pg-mydb', { stdout: 'true\n' });
    const log = vi.fn();
    await enablePgbouncer(db, buildDb(), log);

    // Pull + run happened.
    expect(execState.captures.some((r) => r.tool === 'docker' && r.args[0] === 'pull')).toBe(true);
    const run = execState.runs.find((r) => r.tool === 'docker' && r.args[0] === 'run');
    expect(run).toBeDefined();
    expect(run!.args).toContain('--network');
    expect(run!.args).toContain('nd-net');
    expect(run!.args[run!.args.indexOf('--name') + 1]).toBe('nd-pgb-mydb');

    // Ini + userlist were written via the secretFile helper.
    expect(secretState.written.get('pgbouncer.ini')).toMatch(/\.pgbouncer\.ini$/);
    expect(secretState.written.get('userlist.txt')).toMatch(/\.userlist\.txt$/);

    // Row was stamped with the resolved container name + default port.
    const last = dbState.updates.at(-1);
    expect(last?.set.pgbouncerEnabled).toBe(true);
    expect(last?.set.pgbouncerContainerName).toBe('nd-pgb-mydb');
    expect(last?.set.pgbouncerPort).toBe(6432);

    // Log lines were emitted.
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Pulling PgBouncer image/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Starting PgBouncer sidecar/));
  });

  it('honors a custom port from the row', async () => {
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pg-mydb', { stdout: 'true\n' });
    await enablePgbouncer(db, buildDb({ pgbouncerPort: 7000 }), () => undefined);
    const run = execState.runs.find((r) => r.args[0] === 'run');
    expect(run).toBeDefined();
    expect(run!.args).toContain('7000:7000');
    const last = dbState.updates.at(-1);
    expect(last?.set.pgbouncerPort).toBe(7000);
  });

  it('swallows a failing pull (network flakes, but the rest still runs)', async () => {
    execState.toolResults.set('docker pull bitnami/pgbouncer:1.24.1', {
      throw: new Error('network unreachable'),
    });
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pg-mydb', { stdout: 'true\n' });
    await expect(enablePgbouncer(db, buildDb(), () => undefined)).resolves.toBeUndefined();
    expect(execState.runs.some((r) => r.args[0] === 'run')).toBe(true);
  });

  it('uses a row-supplied pgbouncer container name verbatim', async () => {
    execState.toolResults.set('docker inspect --format {{.State.Running}} nd-pg-mydb', { stdout: 'true\n' });
    await enablePgbouncer(
      db,
      buildDb({ pgbouncerContainerName: 'nd-pgb-custom' }),
      () => undefined,
    );
    const run = execState.runs.find((r) => r.args[0] === 'run');
    expect(run).toBeDefined();
    expect(run!.args[run!.args.indexOf('--name') + 1]).toBe('nd-pgb-custom');
  });
});

describe('disablePgbouncer', () => {
  it('is a no-op when the row is not flagged', async () => {
    await disablePgbouncer(db, buildDb(), () => undefined);
    expect(execState.runs).toEqual([]);
    expect(dbState.updates).toEqual([]);
    expect(fsState.unlinkCalls).toEqual([]);
  });

  it('stops the container, clears the row, and reaps the temp files', async () => {
    await disablePgbouncer(
      db,
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
      () => undefined,
    );
    expect(execState.runs.length).toBe(1);
    expect(execState.runs[0]?.args).toEqual(['rm', '-f', 'nd-pgb-mydb']);
    const upd = dbState.updates.at(-1);
    expect(upd?.set.pgbouncerEnabled).toBe(false);
    expect(upd?.set.pgbouncerContainerName).toBeNull();
    expect(fsState.unlinkCalls).toEqual([
      '/tmp/nd-pgb-mydb.pgbouncer.ini',
      '/tmp/nd-pgb-mydb.userlist.txt',
    ]);
  });

  it('falls back to the slug-derived container name when the column is null', async () => {
    await disablePgbouncer(
      db,
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: null, slug: 'orders' }),
      () => undefined,
    );
    expect(execState.runs[0]?.args).toEqual(['rm', '-f', 'nd-pgb-orders']);
    expect(fsState.unlinkCalls).toEqual([
      '/tmp/nd-pgb-orders.pgbouncer.ini',
      '/tmp/nd-pgb-orders.userlist.txt',
    ]);
  });

  it('swallows a docker rm failure (best-effort teardown)', async () => {
    execState.toolResults.set('docker rm -f nd-pgb-mydb', { throw: new Error('already gone') });
    await disablePgbouncer(
      db,
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
      () => undefined,
    );
    // The row was still cleared.
    const upd = dbState.updates.at(-1);
    expect(upd?.set.pgbouncerEnabled).toBe(false);
  });
});

describe('pgbouncerStatusFor', () => {
  it('returns the disabled shape when the row is not flagged', async () => {
    const status = await pgbouncerStatusFor(buildDb());
    expect(status).toEqual({
      enabled: false,
      containerName: null,
      port: 6432,
      running: false,
      poolMode: null,
      pooledConnectionString: null,
    });
  });

  it('uses the row-supplied port in the disabled shape', async () => {
    const status = await pgbouncerStatusFor(buildDb({ pgbouncerPort: 7000 }));
    expect(status.port).toBe(7000);
  });

  it('returns running=true and the pooled URL when the container is up', async () => {
    execState.toolResults.set(
      'docker inspect --format {{.State.Running}} nd-pgb-mydb',
      { stdout: 'true\n' },
    );
    execState.toolResults.set(
      'docker inspect --format {{index .Config.Env}} nd-pgb-mydb',
      { stdout: '[PGBOUNCER_POOL_MODE=transaction OTHER=foo]\n' },
    );
    const status = await pgbouncerStatusFor(
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
    );
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(true);
    expect(status.poolMode).toBe('transaction');
    expect(status.pooledConnectionString).toBe('postgres://nine:plainpw@nd-pgb-mydb:6432/app');
  });

  it('returns poolMode=null when the env line lacks the variable', async () => {
    execState.toolResults.set(
      'docker inspect --format {{.State.Running}} nd-pgb-mydb',
      { stdout: 'true\n' },
    );
    execState.toolResults.set(
      'docker inspect --format {{index .Config.Env}} nd-pgb-mydb',
      { stdout: '[OTHER=foo]\n' },
    );
    const status = await pgbouncerStatusFor(
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
    );
    expect(status.poolMode).toBeNull();
  });

  it('returns poolMode=null when the env inspect throws (best-effort)', async () => {
    execState.toolResults.set(
      'docker inspect --format {{.State.Running}} nd-pgb-mydb',
      { stdout: 'true\n' },
    );
    execState.toolResults.set(
      'docker inspect --format {{index .Config.Env}} nd-pgb-mydb',
      { throw: new Error('no such container') },
    );
    const status = await pgbouncerStatusFor(
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
    );
    expect(status.running).toBe(true);
    expect(status.poolMode).toBeNull();
  });

  it('returns running=false (and no pooled URL) when the container is down', async () => {
    execState.toolResults.set(
      'docker inspect --format {{.State.Running}} nd-pgb-mydb',
      { stdout: 'false\n' },
    );
    const status = await pgbouncerStatusFor(
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
    );
    expect(status.running).toBe(false);
    expect(status.pooledConnectionString).toBeNull();
  });

  it('returns running=false when the running-inspect throws (container gone)', async () => {
    execState.toolResults.set(
      'docker inspect --format {{.State.Running}} nd-pgb-mydb',
      { throw: new Error('No such object: nd-pgb-mydb') },
    );
    const status = await pgbouncerStatusFor(
      buildDb({ pgbouncerEnabled: true, pgbouncerContainerName: 'nd-pgb-mydb' }),
    );
    expect(status.running).toBe(false);
  });
});
