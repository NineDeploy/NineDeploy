import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync as existsSyncMock, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  backupDatabase,
  connectionString,
  readBackupBytes,
  databaseSize,
  defaultPort,
  ENGINES,
  removeVolume,
  restoreDatabase,
  startDatabase,
  stopDatabase,
  volumeExists,
} from '../src/engine/database.js';

const h = vi.hoisted(() => {
  // decrypt handles BOTH envelope round-trips (v0:… = real envelope shape)
  // and DB passwords (pw:… fallback).
  const decrypt = vi.fn((v: string) => (v.startsWith('v0:') ? v.slice(3) : `pw:${v}`));
  const encrypt = vi.fn((v: string) => `v0:${v}`);
  const run = vi.fn(async (_cmd: string, _args: unknown[], _opts: unknown, sink?: (line: string) => void) => {
    sink?.('');
  });
  const capture = vi.fn(async () => '[]');
  const config: { paths: { dataDir: string } } = { paths: { dataDir: '/tmp/nd-db-test' } };
  return { decrypt, encrypt, run, capture, config };
});

vi.mock('../src/lib/crypto.js', () => ({ decrypt: h.decrypt, encrypt: h.encrypt }));
vi.mock('../src/lib/exec.js', () => ({ run: h.run, capture: h.capture, sleep: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: h.config }));

beforeEach(() => {
  vi.clearAllMocks();
});

const dbRow = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    projectId: null,
    name: 'db',
    slug: 'db',
    engine: 'postgres',
    version: null,
    status: 'running',
    containerName: 'c',
    internalHost: null,
    internalPort: null,
    username: null,
    passwordEncrypted: 'enc',
    dbName: null,
    volumeName: 'v',
    cpuShares: 0,
    memLimitMb: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }) as never;

describe('ENGINES metadata', () => {
  it('maps each engine to image, port, volume and env', () => {
    expect(ENGINES.postgres.image()).toBe('postgres:16');
    expect(ENGINES.postgres.image('17')).toBe('postgres:17');
    expect(ENGINES.mysql.image()).toBe('mysql:8');
    expect(ENGINES.mysql.image('9')).toBe('mysql:9');
    expect(ENGINES.mariadb.image()).toBe('mariadb:11');
    expect(ENGINES.mariadb.image('12')).toBe('mariadb:12');
    expect(ENGINES.redis.image()).toBe('redis:7');
    expect(ENGINES.redis.image('8')).toBe('redis:8');
    expect(ENGINES.mongo.image()).toBe('mongo:7');
    expect(ENGINES.mongo.image('8')).toBe('mongo:8');

    expect(ENGINES.postgres.port).toBe(5432);
    expect(ENGINES.mysql.port).toBe(3306);
    expect(ENGINES.mariadb.port).toBe(3306);
    expect(ENGINES.redis.port).toBe(6379);
    expect(ENGINES.mongo.port).toBe(27017);

    expect(ENGINES.postgres.volumePath).toBe('/var/lib/postgresql/data');
    expect(ENGINES.mysql.volumePath).toBe('/var/lib/mysql');
    expect(ENGINES.mariadb.volumePath).toBe('/var/lib/mysql');
    expect(ENGINES.redis.volumePath).toBe('/data');
    expect(ENGINES.mongo.volumePath).toBe('/data/db');

    expect(ENGINES.postgres.username()).toBe('nine');
    expect(ENGINES.mysql.username()).toBe('root');
    expect(ENGINES.mariadb.username()).toBe('root');
    expect(ENGINES.mongo.username()).toBe('nine');
    expect(ENGINES.redis.username()).toBeUndefined();
    expect(ENGINES.postgres.dbName()).toBe('app');
    expect(ENGINES.mysql.dbName()).toBeUndefined();
    expect(ENGINES.mariadb.dbName()).toBeUndefined();
    expect(ENGINES.redis.dbName()).toBeUndefined();
    expect(ENGINES.mongo.dbName()).toBeUndefined();

    expect(ENGINES.postgres.env('p')).toEqual({ POSTGRES_USER: 'nine', POSTGRES_PASSWORD: 'p', POSTGRES_DB: 'app' });
    expect(ENGINES.mysql.env('p')).toEqual({ MYSQL_ROOT_PASSWORD: 'p' });
    expect(ENGINES.mariadb.env('p')).toEqual({ MARIADB_ROOT_PASSWORD: 'p' });
    expect(ENGINES.redis.env('p')).toEqual({});
    expect(ENGINES.mongo.env('p')).toEqual({ MONGO_INITDB_ROOT_USERNAME: 'nine', MONGO_INITDB_ROOT_PASSWORD: 'p' });
  });

  it('renders mariadb connection strings', () => {
    expect(ENGINES.mariadb.connectionString('db', 3306, 'root', 'pw', undefined)).toBe('mariadb://root:pw@db:3306/');
  });
});

describe('startDatabase', () => {
  it('starts postgres with volume bind and env flags, reusing a retained volume', async () => {
    h.capture.mockResolvedValue('[{"Name":"v"}]');
    const log = vi.fn();

    await startDatabase(dbRow({ engine: 'postgres', version: '16' }), log);

    expect(log).toHaveBeenCalledWith('Reusing retained volume v (previous data restored)');
    expect(log).toHaveBeenCalledWith('Starting postgres database db (c) …');
    expect(h.run).toHaveBeenCalledWith(
      'docker',
      [
        'run', '-d', '--name', 'c', '--network', 'ninedeploy', '--restart', 'unless-stopped',
        '-v', 'v:/var/lib/postgresql/data',
        // Secrets ride in a 0600 env-file, not on the argv.
        '--env-file', expect.any(String),
        'postgres:16',
      ],
      {},
      log,
    );
  });

  it('is a no-op when the container is already running (idempotent restart)', async () => {
    // First capture call is the container-state inspect.
    h.capture.mockResolvedValueOnce('running');
    const log = vi.fn();

    await startDatabase(dbRow({ engine: 'postgres' }), log);

    expect(log).toHaveBeenCalledWith('c already running — reusing');
    expect(h.run).not.toHaveBeenCalled();
  });

  it('removes a stale same-name container before starting (no name conflict)', async () => {
    // Container not running, volume retained. The rm -f may fail if there was
    // nothing to remove — that's absorbed and we still proceed to start.
    h.capture.mockResolvedValue('[{"Name":"v"}]');
    h.run.mockRejectedValueOnce(new Error('no such container'));
    const log = vi.fn();

    await startDatabase(dbRow({ engine: 'postgres' }), log);

    expect(h.run).toHaveBeenCalledWith('docker', ['rm', '-f', 'c'], {}, expect.any(Function));
  });

  it('still starts when the state inspect fails (treats it as not running)', async () => {
    h.capture.mockRejectedValue(new Error('inspect failed'));
    const log = vi.fn();

    await startDatabase(dbRow({ engine: 'postgres' }), log);

    expect(log).toHaveBeenCalledWith('Starting postgres database db (c) …');
    expect(h.run).toHaveBeenCalledWith('docker', expect.arrayContaining(['run', '-d', '--name', 'c']), {}, log);
  });

  it('adds cpu/memory flags and defaults the mysql tag when no version is set', async () => {
    h.capture.mockResolvedValue('No such volume');
    const log = vi.fn();

    await startDatabase(
      dbRow({ engine: 'mysql', containerName: 'cm', volumeName: 'vm', cpuShares: 512, memLimitMb: 256 }),
      log,
    );

    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Reusing retained volume'));
    expect(h.run).toHaveBeenCalledWith(
      'docker',
      [
        'run', '-d', '--name', 'cm', '--network', 'ninedeploy', '--restart', 'unless-stopped',
        '--cpu-shares', '512', '--memory', '256m',
        '-v', 'vm:/var/lib/mysql',
        '--env-file', expect.any(String),
        'mysql:8',
      ],
      {},
      log,
    );
  });

  it('starts redis without env flags', async () => {
    h.capture.mockResolvedValue('No such volume');
    const log = vi.fn();

    await startDatabase(dbRow({ engine: 'redis', version: '8' }), log);

    expect(h.run).toHaveBeenCalledWith(
      'docker',
      // Redis has no env vars → no --env-file at all.
      ['run', '-d', '--name', 'c', '--network', 'ninedeploy', '--restart', 'unless-stopped', '-v', 'v:/data', 'redis:8'],
      {},
      log,
    );
  });

  it('starts mongo with init root credentials', async () => {
    h.capture.mockResolvedValue('No such volume');
    const log = vi.fn();

    await startDatabase(dbRow({ engine: 'mongo' }), log);

    expect(h.run).toHaveBeenCalledWith(
      'docker',
      [
        'run', '-d', '--name', 'c', '--network', 'ninedeploy', '--restart', 'unless-stopped',
        '-v', 'v:/data/db',
        '--env-file', expect.any(String),
        'mongo:7',
      ],
      {},
      log,
    );
  });

  it('throws for an unknown engine', async () => {
    await expect(startDatabase(dbRow({ engine: 'oracle' }), vi.fn())).rejects.toThrow('Unknown engine: oracle');
  });

  it('throws when the container or volume name is missing', async () => {
    await expect(
      startDatabase(dbRow({ containerName: null, volumeName: null }), vi.fn()),
    ).rejects.toThrow('database has no container/volume name');
  });
});

describe('volumeExists', () => {
  it('returns true when docker reports the volume', async () => {
    h.capture.mockResolvedValue('[{"Name":"v"}]');
    await expect(volumeExists('v')).resolves.toBe(true);
  });

  it('returns false when docker says the volume does not exist', async () => {
    h.capture.mockResolvedValue('No such volume');
    await expect(volumeExists('v')).resolves.toBe(false);
  });

  it('returns false when the inspect command fails', async () => {
    h.capture.mockRejectedValue(new Error('docker down'));
    await expect(volumeExists('v')).resolves.toBe(false);
  });
});

describe('stopDatabase', () => {
  it('stops and removes the container but keeps the volume', async () => {
    const log = vi.fn();

    await stopDatabase(dbRow(), log);

    expect(log).toHaveBeenCalledWith('Stopping c (volume retained) …');
    expect(h.run).toHaveBeenCalledWith('docker', ['rm', '-f', 'c'], {}, expect.any(Function));
  });

  it('does nothing when there is no container name', async () => {
    const log = vi.fn();
    await stopDatabase(dbRow({ containerName: null }), log);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('swallows remove errors', async () => {
    h.run.mockRejectedValueOnce(new Error('gone'));
    await expect(stopDatabase(dbRow(), vi.fn())).resolves.toBeUndefined();
  });
});

describe('removeVolume', () => {
  it('deletes the named volume', async () => {
    const log = vi.fn();

    await removeVolume('v', log);

    expect(log).toHaveBeenCalledWith('Deleting volume v …');
    expect(h.run).toHaveBeenCalledWith('docker', ['volume', 'rm', 'v'], {}, log);
  });

  it('swallows errors', async () => {
    h.run.mockRejectedValueOnce(new Error('volume busy'));
    await expect(removeVolume('v', vi.fn())).resolves.toBeUndefined();
  });
});

describe('connectionString', () => {
  it('builds a postgres connection string with internal host/port', () => {
    const d = dbRow({ engine: 'postgres', internalHost: 'pg.internal', internalPort: 15432 });
    expect(connectionString(d)).toBe('postgres://nine:pw%3Aenc@pg.internal:15432/app');
    expect(h.decrypt).toHaveBeenCalledWith('enc');
  });

  it('falls back to the container name and engine port', () => {
    const d = dbRow({ engine: 'mysql' });
    expect(connectionString(d)).toBe('mysql://root:pw%3Aenc@c:3306/');
  });

  it('handles missing host/port and an empty user (redis)', () => {
    const d = dbRow({ engine: 'redis', internalHost: null, containerName: null, internalPort: null });
    expect(connectionString(d)).toBe('redis://:6379');
  });

  it('builds a mongo connection string', () => {
    expect(connectionString(dbRow({ engine: 'mongo' }))).toBe('mongodb://nine:pw%3Aenc@c:27017');
  });

  it('throws for an unknown engine', () => {
    expect(() => connectionString(dbRow({ engine: 'oracle' }))).toThrow('Unknown engine: oracle');
  });
});

describe('defaultPort', () => {
  it('returns the engine port or 0 for unknown engines', () => {
    expect(defaultPort('postgres')).toBe(5432);
    expect(defaultPort('bogus')).toBe(0);
  });
});

describe('databaseSize', () => {
  it('returns 0 for unknown engines or missing container names', async () => {
    await expect(databaseSize(dbRow({ engine: 'oracle' }))).resolves.toBe(0);
    await expect(databaseSize(dbRow({ containerName: null }))).resolves.toBe(0);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('queries postgres size and falls back to 0 on garbage', async () => {
    h.capture.mockResolvedValueOnce('12345');
    await expect(databaseSize(dbRow({ engine: 'postgres' }))).resolves.toBe(12345);
    expect(h.capture).toHaveBeenCalledWith('docker', ['exec', 'c', 'psql', '-U', 'nine', '-d', 'app', '-tAc', 'SELECT pg_database_size(current_database())']);

    h.capture.mockResolvedValueOnce('not-a-number');
    await expect(databaseSize(dbRow({ engine: 'postgres' }))).resolves.toBe(0);
  });

  it('parses redis used_memory and returns 0 when absent', async () => {
    h.capture.mockResolvedValueOnce('used_memory:456\n');
    await expect(databaseSize(dbRow({ engine: 'redis' }))).resolves.toBe(456);

    h.capture.mockResolvedValueOnce('no match here');
    await expect(databaseSize(dbRow({ engine: 'redis' }))).resolves.toBe(0);
  });

  it('queries mysql size with the decrypted password', async () => {
    h.capture.mockResolvedValueOnce('789');
    await expect(databaseSize(dbRow({ engine: 'mysql' }))).resolves.toBe(789);
    expect(h.decrypt).toHaveBeenCalledWith('enc');

    h.capture.mockResolvedValueOnce('bad');
    await expect(databaseSize(dbRow({ engine: 'mysql' }))).resolves.toBe(0);
  });

  it('parses mongo dataSize', async () => {
    h.capture.mockResolvedValueOnce('123.5');
    await expect(databaseSize(dbRow({ engine: 'mongo' }))).resolves.toBe(123.5);

    h.capture.mockResolvedValueOnce('nothing');
    await expect(databaseSize(dbRow({ engine: 'mongo' }))).resolves.toBe(0);
  });

  it('returns 0 when the query fails', async () => {
    h.capture.mockRejectedValue(new Error('not ready'));
    await expect(databaseSize(dbRow({ engine: 'postgres' }))).resolves.toBe(0);
  });

  it('returns 0 when the engine is not one of the four handled engines', async () => {
    // A truthy (inherited) ENGINES entry plus a container name passes the guard
    // and reaches the engine dispatch without matching any handled branch.
    await expect(databaseSize(dbRow({ engine: 'toString', containerName: 'c' }))).resolves.toBe(0);
  });
});

describe('backupDatabase', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-backup-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('backs up postgres via a container-side dump file + docker cp (no in-memory dump)', async () => {
    const file = path.join(tmp, 'pg.sql');
    writeFileSync(file, ''); // the (mocked) docker cp would land here
    const log = vi.fn();
    await backupDatabase(dbRow({ engine: 'postgres' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'pg_dump', '-U', 'nine', '-d', 'app', '--file=/tmp/ninedeploy-dump'], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', 'c:/tmp/ninedeploy-dump', file], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'rm', '-f', '/tmp/ninedeploy-dump'], {}, expect.any(Function));
    expect(h.capture).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe(`v0:${Buffer.from('').toString('base64')}`);
  });

  it('backs up mysql with the decrypted password via result-file + docker cp', async () => {
    const file = path.join(tmp, 'mysql.sql');
    writeFileSync(file, '');
    const log = vi.fn();
    await backupDatabase(dbRow({ engine: 'mysql' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mysqldump', '-uroot', '--password=pw:enc', '--all-databases', '--result-file=/tmp/ninedeploy-dump',
    ], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', 'c:/tmp/ninedeploy-dump', file], {}, log);
    expect(h.decrypt).toHaveBeenCalledWith('enc');
    expect(h.capture).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe(`v0:${Buffer.from('').toString('base64')}`);
  });

  it('backs up redis via docker exec SAVE + docker cp, then encrypts', async () => {
    const file = path.join(tmp, 'redis.rdb');
    writeFileSync(file, 'RDB-BYTES'); // the (mocked) docker cp lands here
    const log = vi.fn();
    await backupDatabase(dbRow({ engine: 'redis' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'redis-cli', 'SAVE'], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', 'c:/data/dump.rdb', file], {}, log);
    expect(readFileSync(file, 'utf8')).toBe(`v0:${Buffer.from('RDB-BYTES').toString('base64')}`);
  });

  it('backs up mongo via a static container temp file + docker cp, then encrypts', async () => {
    const file = path.join(tmp, 'mongo.archive');
    writeFileSync(file, 'MONGO-BYTES');
    const log = vi.fn();
    await backupDatabase(dbRow({ engine: 'mongo' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mongodump',
      '-u', 'nine', '-p', 'pw:enc', '--authenticationDatabase', 'admin',
      '--archive=/tmp/ninedeploy-dump', '--gzip',
    ], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', 'c:/tmp/ninedeploy-dump', file], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'rm', '-f', '/tmp/ninedeploy-dump'], {}, expect.any(Function));
    expect(readFileSync(file, 'utf8')).toBe(`v0:${Buffer.from('MONGO-BYTES').toString('base64')}`);
  });

  it('throws for databases that are not runnable', async () => {
    await expect(backupDatabase(dbRow({ engine: 'oracle' }), '/f', vi.fn())).rejects.toThrow('database not runnable');
    await expect(backupDatabase(dbRow({ containerName: null }), '/f', vi.fn())).rejects.toThrow('database not runnable');
  });

  it('hits the unsupported fallback for a non-owned engine key', async () => {
    await expect(backupDatabase(dbRow({ engine: 'toString', containerName: 'c' }), '/f', vi.fn())).rejects.toThrow(
      'backup not supported for toString',
    );
  });
});

describe('readBackupBytes', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-read-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('decrypts an envelope backup to the original bytes', () => {
    const f = path.join(tmp, 'enc.dump');
    writeFileSync(f, `v0:${Buffer.from('hello').toString('base64')}`);
    expect(readBackupBytes(f).toString()).toBe('hello');
  });

  it('returns a legacy plaintext backup as-is', () => {
    const f = path.join(tmp, 'legacy.dump');
    const b64 = Buffer.from('legacy').toString('base64');
    writeFileSync(f, b64);
    expect(readBackupBytes(f).toString()).toBe('legacy');
  });
});

describe('restoreDatabase', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-restore-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const encFile = (plain: string) => {
    const f = path.join(tmp, `enc-${plain.length}.dump`);
    writeFileSync(f, `v0:${Buffer.from(plain).toString('base64')}>`);
    return f;
  };

  it('restores postgres from an ENCRYPTED backup (decrypts to a temp sibling)', async () => {
    const log = vi.fn();
    const file = encFile('-- plain sql --');
    await restoreDatabase(dbRow({ engine: 'postgres' }), file, log);
    // docker cp receives the DECRYPTED sibling, not the envelope file.
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', `${file}.dec`, 'c:/tmp/ninedeploy-restore'], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'psql', '-U', 'nine', '-d', 'app', '-f', '/tmp/ninedeploy-restore'], {}, log);
  });

  it('restores from a LEGACY plaintext backup as-is (no envelope)', async () => {
    const log = vi.fn();
    const file = path.join(tmp, 'legacy.dump');
    writeFileSync(file, '-- legacy plain --');
    await restoreDatabase(dbRow({ engine: 'postgres' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', file, 'c:/tmp/ninedeploy-restore'], {}, log);
  });

  it('restores mysql with the decrypted password via source (no shell interpolation)', async () => {
    const log = vi.fn();
    const file = encFile('USE app;');
    await restoreDatabase(dbRow({ engine: 'mysql' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', `${file}.dec`, 'c:/tmp/ninedeploy-restore'], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mysql', '-uroot', '--password=pw:enc', '-e', 'source /tmp/ninedeploy-restore',
    ], {}, log);
    expect(h.decrypt).toHaveBeenCalledWith('enc');
  });

  it('backs up mariadb via mariadb-dump', async () => {
    const file = path.join(tmp, 'mariadb.sql');
    writeFileSync(file, '');
    const log = vi.fn();
    await backupDatabase(dbRow({ engine: 'mariadb' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mariadb-dump', '-uroot', '--password=pw:enc', '--all-databases', '--result-file=/tmp/ninedeploy-dump',
    ], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', 'c:/tmp/ninedeploy-dump', file], {}, log);
    expect(h.capture).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe(`v0:${Buffer.from('').toString('base64')}`);
  });

  it('restores mariadb via the mariadb client', async () => {
    const log = vi.fn();
    const file = encFile('USE app;');
    await restoreDatabase(dbRow({ engine: 'mariadb' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mariadb', '-uroot', '--password=pw:enc', '-e', 'source /tmp/ninedeploy-restore',
    ], {}, log);
  });

  it('queries the mariadb size like mysql', async () => {
    h.capture.mockResolvedValueOnce('4242');
    await expect(databaseSize(dbRow({ engine: 'mariadb' }))).resolves.toBe(4242);
    expect(h.capture).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mariadb', '-uroot', '--password=pw:enc', '-N',
      '-e', 'SELECT IFNULL(SUM(data_length+index_length),0) FROM information_schema.tables',
    ]);
  });

  it('restores mongo via docker cp + mongorestore --archive=path', async () => {
    const log = vi.fn();
    const file = encFile('MONGO');
    await restoreDatabase(dbRow({ engine: 'mongo' }), file, log);
    expect(h.run).toHaveBeenCalledWith('docker', ['cp', `${file}.dec`, 'c:/tmp/ninedeploy-restore'], {}, log);
    expect(h.run).toHaveBeenCalledWith('docker', [
      'exec', 'c', 'mongorestore',
      '-u', 'nine', '-p', 'pw:enc', '--authenticationDatabase', 'admin',
      '--archive=/tmp/ninedeploy-restore', '--gzip', '--drop',
    ], {}, log);
  });

  it('removes the staged restore file and decrypted sibling afterwards', async () => {
    const file = encFile('x');
    await restoreDatabase(dbRow({ engine: 'postgres' }), file, vi.fn());
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'rm', '-f', '/tmp/ninedeploy-restore'], {}, expect.any(Function));
    expect(existsSyncMock(`${file}.dec`)).toBe(false);
  });

  it('swallows a failing cleanup after a successful restore', async () => {
    h.run.mockImplementation(async (_cmd: string, args: unknown[]) => {
      if (Array.isArray(args) && args.includes('rm')) throw new Error('cleanup failed');
    });
    const file = encFile('y');
    await expect(restoreDatabase(dbRow({ engine: 'postgres' }), file, vi.fn())).resolves.toBeUndefined();
    expect(h.run).toHaveBeenCalledWith('docker', ['exec', 'c', 'rm', '-f', '/tmp/ninedeploy-restore'], {}, expect.any(Function));
  });

  it('rejects redis restores and non-runnable databases', async () => {
    await expect(restoreDatabase(dbRow({ engine: 'redis' }), '/f', vi.fn())).rejects.toThrow('restore not supported for redis');
    await expect(restoreDatabase(dbRow({ engine: 'oracle' }), '/f', vi.fn())).rejects.toThrow('database not runnable');
    await expect(restoreDatabase(dbRow({ containerName: null }), '/f', vi.fn())).rejects.toThrow('database not runnable');
  });

  it('hits the unsupported fallback for a non-owned engine key', async () => {
    await expect(restoreDatabase(dbRow({ engine: 'toString', containerName: 'c' }), '/f', vi.fn())).rejects.toThrow(
      'restore not supported for toString',
    );
  });
});
