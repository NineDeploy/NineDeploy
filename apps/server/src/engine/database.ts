import { createReadStream, createWriteStream, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Database } from '@ninedeploy/db';
import { createBackupCipher, createBackupDecipher, decrypt } from '../lib/crypto.js';
import { ensureDockerImage, pullDockerImage } from '../lib/dockerPull.js';
import { capture, run } from '../lib/exec.js';
import { writeSecretFile } from '../lib/secretFile.js';
import { NETWORK } from './proxy.js';

const swallow = () => {};
/** Static temp paths used inside managed containers for backup/restore staging. */
const DUMP_TMP = '/tmp/ninedeploy-dump';
const RESTORE_TMP = '/tmp/ninedeploy-restore';

/** Matches a versioned secret envelope ("v<ver>:…"). Backups written since the
 *  encryption change carry this prefix; anything else is a legacy plaintext dump. */
const ENVELOPE_RE = /^v\d+:/;
const STREAM_HEADER_PREFIX = 'NDBK1:';
const GCM_TAG_BYTES = 16;

/**
 * Encrypt a backup file in place (master-key envelope over base64-encoded dump
 * content — binary-safe). Plain dumps on disk would leak every DB credential
 * they contain to anyone who steals the data directory, defeating the at-rest
 * encryption of the credentials themselves.
 */
async function encryptFileInPlace(file: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.enc`;
  const { cipher, header } = createBackupCipher();
  const output = createWriteStream(tmp, { mode: 0o600 });
  let headerWritten = false;
  const envelope = new Transform({
    transform(chunk, _encoding, callback) {
      if (!headerWritten) {
        this.push(header);
        headerWritten = true;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (!headerWritten) this.push(header);
      this.push(cipher.getAuthTag());
      callback();
    },
  });
  try {
    await pipeline(createReadStream(file), cipher, envelope, output);
    renameSync(tmp, file);
  } catch (error) {
    output.destroy();
    try { unlinkSync(tmp); } catch { /* absent */ }
    throw error;
  }
}

interface StreamBackupLayout {
  dataStart: number;
  dataEnd: number;
  header: string;
  authTag: Buffer;
}

async function streamBackupLayout(file: string): Promise<StreamBackupLayout | null> {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    const prefix = Buffer.alloc(Math.min(128, stat.size));
    await handle.read(prefix, 0, prefix.length, 0);
    const newline = prefix.indexOf(0x0a);
    if (newline < 0) return null;
    const header = prefix.subarray(0, newline + 1).toString('utf8');
    if (!header.startsWith(STREAM_HEADER_PREFIX) || stat.size < newline + 1 + GCM_TAG_BYTES) return null;
    const authTag = Buffer.alloc(GCM_TAG_BYTES);
    await handle.read(authTag, 0, GCM_TAG_BYTES, stat.size - GCM_TAG_BYTES);
    return { dataStart: newline + 1, dataEnd: stat.size - GCM_TAG_BYTES - 1, header, authTag };
  } finally {
    await handle.close();
  }
}

async function fileHead(file: string, bytes = 32): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(head, 0, bytes, 0);
    return head.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Plaintext backup stream for downloads; current backups never enter the heap. */
export async function createBackupReadStream(file: string): Promise<Readable> {
  const layout = await streamBackupLayout(file);
  if (layout) {
    return createReadStream(file, { start: layout.dataStart, end: layout.dataEnd })
      .pipe(createBackupDecipher(layout.header, layout.authTag));
  }
  const head = await fileHead(file);
  if (ENVELOPE_RE.test(head)) return Readable.from(readBackupBytes(file));
  return createReadStream(file);
}

/** Read a backup file and return its PLAINTEXT bytes (envelope-aware). */
export function readBackupBytes(file: string): Buffer {
  // Single read: legacy files are returned as their raw bytes; envelope files
  // are base64-decoded after decryption. (Full-file buffering is inherent to
  // the single-line envelope format; multi-GB dumps are handled by the
  // container-side dump + docker cp path, not by growing this buffer.)
  const raw = readFileSync(file);
  if (ENVELOPE_RE.test(raw.toString('utf8').slice(0, 32))) {
    return Buffer.from(decrypt(raw.toString('utf8')), 'base64');
  }
  return raw;
}

/**
 * Prepare a backup file for restore: encrypted backups are decrypted to a
 * sibling temp file; legacy plaintext files are used as-is. Returns the path to
 * feed to `docker cp` and a cleanup function.
 */
async function stageForRestore(file: string): Promise<{ path: string; cleanup: () => void }> {
  const layout = await streamBackupLayout(file);
  if (layout) {
    const dec = `${file}.${process.pid}.${Date.now()}.dec`;
    await pipeline(
      createReadStream(file, { start: layout.dataStart, end: layout.dataEnd }),
      createBackupDecipher(layout.header, layout.authTag),
      createWriteStream(dec, { mode: 0o600 }),
    );
    return { path: dec, cleanup: () => { try { unlinkSync(dec); } catch { /* gone */ } } };
  }
  const head = await fileHead(file);
  if (!ENVELOPE_RE.test(head)) return { path: file, cleanup: () => undefined };
  const dec = `${file}.dec`;
  writeFileSync(dec, readBackupBytes(file), { mode: 0o600 });
  return { path: dec, cleanup: () => { try { unlinkSync(dec); } catch { /* gone */ } } };
}

interface EngineConfig {
  image: (version?: string) => string;
  port: number;
  volumePath: string;
  env: (password: string) => Record<string, string>;
  /** Engines that cannot take a password via env vars (redis/valkey) get it
   *  as a `--requirepass` container-command argument instead. */
  authViaArg?: boolean;
  username: () => string | undefined;
  dbName: () => string | undefined;
  connectionString: (host: string, port: number, user: string, password: string, dbName: string | undefined) => string;
}

/** RFC-3986-encode a userinfo/password segment so special chars can't break (or inject into) the URI. */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

export const ENGINES: Record<string, EngineConfig> = {
  postgres: {
    image: (v) => (v === 'vector' || v === 'pgvector' ? 'pgvector/pgvector:pg16' : `postgres:${v || '16'}`),
    port: 5432,
    volumePath: '/var/lib/postgresql/data',
    env: (p) => ({ POSTGRES_USER: 'nine', POSTGRES_PASSWORD: p, POSTGRES_DB: 'app' }),
    username: () => 'nine',
    dbName: () => 'app',
    connectionString: (h, prt, u, p, d) => `postgres://${enc(u)}:${enc(p)}@${h}:${prt}/${d}`,
  },
  mysql: {
    image: (v) => `mysql:${v || '8.4'}`,
    port: 3306,
    volumePath: '/var/lib/mysql',
    env: (p) => ({ MYSQL_ROOT_PASSWORD: p, MYSQL_DATABASE: 'app' }),
    username: () => 'root',
    dbName: () => 'app',
    connectionString: (h, prt, u, p, d) => `mysql://${enc(u)}:${enc(p)}@${h}:${prt}/${d ?? 'app'}`,
  },
  mariadb: {
    image: (v) => `mariadb:${v || '11'}`,
    port: 3306,
    volumePath: '/var/lib/mysql',
    env: (p) => ({ MARIADB_ROOT_PASSWORD: p, MARIADB_DATABASE: 'app' }),
    username: () => 'root',
    dbName: () => 'app',
    connectionString: (h, prt, u, p, d) => `mariadb://${enc(u)}:${enc(p)}@${h}:${prt}/${d ?? 'app'}`,
  },
  redis: {
    image: (v) => `redis:${v || '7'}`,
    port: 6379,
    volumePath: '/data',
    env: () => ({}),
    authViaArg: true,
    username: () => undefined,
    dbName: () => undefined,
    connectionString: (h, prt, _u, p) => `redis://:${enc(p)}@${h}:${prt}`,
  },
  valkey: {
    image: (v) => `valkey/valkey:${v || '8'}`,
    port: 6379,
    volumePath: '/data',
    env: () => ({}),
    authViaArg: true,
    username: () => undefined,
    dbName: () => undefined,
    connectionString: (h, prt, _u, p) => `valkey://:${enc(p)}@${h}:${prt}`,
  },
  mongo: {
    image: (v) => `mongo:${v || '7'}`,
    port: 27017,
    volumePath: '/data/db',
    env: (p) => ({ MONGO_INITDB_ROOT_USERNAME: 'nine', MONGO_INITDB_ROOT_PASSWORD: p }),
    username: () => 'nine',
    dbName: () => undefined,
    connectionString: (h, prt, u, p) => `mongodb://${enc(u)}:${enc(p)}@${h}:${prt}`,
  },
  clickhouse: {
    image: (v) => `clickhouse/clickhouse-server:${v || '24'}`,
    port: 8123,
    volumePath: '/var/lib/clickhouse',
    env: (p) => ({ CLICKHOUSE_USER: 'nine', CLICKHOUSE_PASSWORD: p, CLICKHOUSE_DB: 'app' }),
    username: () => 'nine',
    dbName: () => 'app',
    connectionString: (h, prt, u, p, d) => `clickhouse://${enc(u)}:${enc(p)}@${h}:${prt}/${d ?? 'default'}`,
  },
  meilisearch: {
    image: (v) => `getmeili/meilisearch:${v || 'v1.12'}`,
    port: 7700,
    volumePath: '/meili_data',
    env: (p) => ({ MEILI_MASTER_KEY: p, MEILI_NO_ANALYTICS: 'true' }),
    username: () => undefined,
    dbName: () => undefined,
    connectionString: (h, prt, _u, p) => `http://:${enc(p)}@${h}:${prt}`,
  },
  rabbitmq: {
    image: (v) => `rabbitmq:${v || '3-management'}`,
    port: 5672,
    volumePath: '/var/lib/rabbitmq',
    env: (p) => ({ RABBITMQ_DEFAULT_USER: 'nine', RABBITMQ_DEFAULT_PASS: p }),
    username: () => 'nine',
    dbName: () => undefined,
    connectionString: (h, prt, u, p) => `amqp://${enc(u)}:${enc(p)}@${h}:${prt}/`,
  },
};

/** Studio image for the given database engine. */
export function studioImageForEngine(engine: string): { image: string; containerPort: number } {
  if (engine === 'redis' || engine === 'valkey') {
    return { image: 'rediscommander/redis-commander:latest', containerPort: 8081 };
  }
  return { image: 'adminer:latest', containerPort: 8080 };
}

/** Check if database studio container is running. */
export async function isDatabaseStudioRunning(d: Database): Promise<boolean> {
  const name = `nd-studio-${d.slug}`;
  return containerRunning(name);
}

/** Start database web studio container on shared network. */
export async function startDatabaseStudio(d: Database, port: number, log: (line: string) => void): Promise<void> {
  const name = `nd-studio-${d.slug}`;
  if (await containerRunning(name)) return;
  await run('docker', ['rm', '-f', name], {}, swallow).catch(() => undefined);
  const studio = studioImageForEngine(d.engine);
  log(`Preparing Web Studio image ${studio.image} …`);
  await ensureDockerImage(studio.image, log);
  const args = [
    'run', '-d', '--name', name, '--network', NETWORK, '--restart', 'unless-stopped',
    '-p', `${port}:${studio.containerPort}`,
  ];
  if (d.engine === 'redis' || d.engine === 'valkey') {
    const host = d.internalHost || d.containerName;
    args.push('-e', `REDIS_HOSTS=local:${host}:${defaultPort(d.engine)}`);
  }
  args.push(studio.image);
  log(`Starting Web Studio for ${d.name} on :${port} …`);
  await run('docker', args, {}, log);
}

/** Stop database web studio container. */
export async function stopDatabaseStudio(d: Database, log: (line: string) => void): Promise<void> {
  const name = `nd-studio-${d.slug}`;
  log(`Stopping Web Studio ${name} …`);
  await run('docker', ['rm', '-f', name], {}, swallow).catch(() => undefined);
}

/** Whether a container exists and is currently in the `running` state. */
export async function containerRunning(name: string): Promise<boolean> {
  try {
    const out = await capture('docker', ['inspect', name, '--format', '{{.State.Status}}']);
    return out.trim() === 'running';
  } catch {
    return false;
  }
}

/** Run a managed database container on the shared network with a persistent volume. */
export async function startDatabase(d: Database, log: (line: string) => void): Promise<void> {
  const cfg = ENGINES[d.engine];
  if (!cfg) throw new Error(`Unknown engine: ${d.engine}`);
  if (!d.containerName || !d.volumeName) throw new Error('database has no container/volume name');

  // Idempotency: if the database is already running, do nothing (e.g. on server
  // restart). This avoids a `docker run` name-conflict failure.
  if (await containerRunning(d.containerName)) {
    log(`${d.containerName} already running — reusing`);
    return;
  }

  // Never let `docker run` perform an implicit pull. Docker 29/containerd can
  // fail that hidden pull with code 125 when overlayfs snapshot metadata is
  // stale; the shared pull helper detects and safely recovers that condition.
  const image = cfg.image(d.version ?? undefined);
  log(`Pulling database image ${image} …`);
  await pullDockerImage(image, log);

  // Detect a retained volume from a previous deployment of the same name → its
  // data will be reused automatically by Docker (the volume bind is idempotent).
  if (await volumeExists(d.volumeName)) {
    log(`Reusing retained volume ${d.volumeName} (previous data restored)`);
  }

  // Remove any stale (stopped) container of the same name so `docker run` does
  // not fail with a name conflict; the retained volume preserves the data.
  await run('docker', ['rm', '-f', d.containerName], {}, swallow).catch(() => undefined);

  const password = decrypt(d.passwordEncrypted);
  const args = ['run', '-d', '--name', d.containerName, '--network', NETWORK, '--restart', 'unless-stopped'];
  if (d.cpuShares > 0) args.push('--cpu-shares', String(d.cpuShares));
  if (d.memLimitMb > 0) args.push('--memory', `${d.memLimitMb}m`);
  args.push('-v', `${d.volumeName}:${cfg.volumePath}`);
  // Pass secrets via a 0600 env-file instead of `-e KEY=value` on the argv —
  // argv is visible to every local user via `ps`.
  const vars = cfg.env(password);
  const envFile = Object.keys(vars).length > 0
    ? writeSecretFile('nd-db', 'database.env', `${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
    : null;
  if (envFile) args.push('--env-file', envFile.path);
  // redis/valkey have no password env var — the password is passed as the
  // container command's `--requirepass` argument (visible via docker inspect,
  // but the container refuses unauthenticated connections on the shared
  // network, closing the "any container can FLUSHALL" gap).
  if (cfg.authViaArg) args.push('--requirepass', password);
  args.push(image);

  log(`Starting ${d.engine} database ${d.name} (${d.containerName}) …`);
  let startFailed = false;
  let startError: unknown;
  try {
    await run('docker', args, {}, log);
  } catch (err) {
    startFailed = true;
    startError = err;
  } finally {
    envFile?.cleanup();
  }

  if (startFailed) {
    // Docker can return 125 after the daemon has already created and started
    // the container (for example when its response path races with containerd).
    // Reconcile against daemon state before reporting a false failure and
    // leaving the persisted DB row in `error`.
    if (await containerRunning(d.containerName)) {
      log(`${d.containerName} is running despite docker run failure — adopting it`);
      return;
    }
    throw startError;
  }
}

/** Whether a named Docker volume exists. */
export async function volumeExists(name: string): Promise<boolean> {
  try {
    const out = await capture('docker', ['volume', 'inspect', name]);
    return !out.includes('No such volume');
  } catch {
    return false;
  }
}

/** Stop + remove the database container, but KEEP its volume so data survives. */
export async function stopDatabase(d: Database, log: (line: string) => void): Promise<void> {
  if (d.containerName) {
    log(`Stopping ${d.containerName} (volume retained) …`);
    await run('docker', ['rm', '-f', d.containerName], {}, () => {}).catch(() => undefined);
  }
}

/** Permanently delete a named volume (destructive — the real cleanup). */
export async function removeVolume(name: string, log: (line: string) => void): Promise<void> {
  log(`Deleting volume ${name} …`);
  await run('docker', ['volume', 'rm', name], {}, log).catch(() => undefined);
}

/** Build the connection string a service uses to reach this database. */
export function connectionString(d: Database): string {
  const cfg = ENGINES[d.engine];
  if (!cfg) throw new Error(`Unknown engine: ${d.engine}`);
  const password = decrypt(d.passwordEncrypted);
  const user = cfg.username() ?? '';
  return cfg.connectionString(d.internalHost ?? d.containerName ?? '', d.internalPort ?? cfg.port, user, password, cfg.dbName());
}

export const defaultPort = (engine: string): number => ENGINES[engine]?.port ?? 0;

// ── storage + backup / restore ────────────────────────────────────────────

/** Live on-disk size of a managed database (bytes), via engine-specific query. */
export async function databaseSize(d: Database): Promise<number> {
  const cfg = ENGINES[d.engine];
  if (!cfg || !d.containerName) return 0;
  try {
    if (d.engine === 'postgres') {
      const out = await capture('docker', ['exec', d.containerName, 'psql', '-U', cfg.username()!, '-d', cfg.dbName()!, '-tAc', "SELECT pg_database_size(current_database())"]);
      return Number(out.trim()) || 0;
    }
    if (d.engine === 'redis' || d.engine === 'valkey') {
      const pass = decrypt(d.passwordEncrypted);
      const out = await capture('docker', ['exec', d.containerName, 'redis-cli', '-a', pass, '--no-auth-warning', 'INFO', 'memory']);
      const m = /used_memory:(\d+)/.exec(out);
      return m ? Number(m[1]) : 0;
    }
    if (d.engine === 'mysql' || d.engine === 'mariadb') {
      const pass = decrypt(d.passwordEncrypted);
      const client = d.engine === 'mysql' ? 'mysql' : 'mariadb';
      const out = await capture('docker', [
        'exec', d.containerName, client, '-uroot', `--password=${pass}`, '-N',
        '-e', 'SELECT IFNULL(SUM(data_length+index_length),0) FROM information_schema.tables',
      ]);
      return Number(out.trim()) || 0;
    }
    if (d.engine === 'mongo') {
      const out = await capture('docker', ['exec', d.containerName, 'mongosh', '--quiet', '--eval', 'db.getSiblingDB("app").stats().dataSize']);
      return Number(out.match(/[\d.]+/)?.[0]) || 0;
    }
  } catch {
    /* engine not ready yet */
  }
  return 0;
}

/**
 * Dump a managed database to `file` (host path). Implemented with arg arrays +
 * `docker cp` only — never a host `sh -c` — so a crafted password or path can
 * never break out into shell execution. Passwords travel as a docker argv
 * `--password=` value (visible to a local admin via `docker inspect`, but not
 * shell-injectable) rather than an interpolated shell string.
 */
export async function backupDatabase(d: Database, file: string, log: (line: string) => void): Promise<void> {
  const cfg = ENGINES[d.engine];
  if (!cfg || !d.containerName) throw new Error('database not runnable');
  const cn = d.containerName;
  if (d.engine === 'postgres') {
    // Dump to a file INSIDE the container, then `docker cp` it out — the
    // whole dump never sits in this process's memory (a `capture`d stdout
    // string would OOM the server on large databases).
    await run('docker', ['exec', cn, 'pg_dump', '-U', cfg.username()!, '-d', cfg.dbName()!, `--file=${DUMP_TMP}`], {}, log);
    await run('docker', ['cp', `${cn}:${DUMP_TMP}`, file], {}, log);
    await run('docker', ['exec', cn, 'rm', '-f', DUMP_TMP], {}, swallow);
  } else if (d.engine === 'mysql' || d.engine === 'mariadb') {
    const pass = decrypt(d.passwordEncrypted);
    const dumper = d.engine === 'mysql' ? 'mysqldump' : 'mariadb-dump';
    await run('docker', ['exec', cn, dumper, '-uroot', `--password=${pass}`, '--all-databases', `--result-file=${DUMP_TMP}`], {}, log);
    await run('docker', ['cp', `${cn}:${DUMP_TMP}`, file], {}, log);
    await run('docker', ['exec', cn, 'rm', '-f', DUMP_TMP], {}, swallow);
  } else if (d.engine === 'redis' || d.engine === 'valkey') {
    const pass = decrypt(d.passwordEncrypted);
    await run('docker', ['exec', cn, 'redis-cli', '-a', pass, '--no-auth-warning', 'SAVE'], {}, log);
    await run('docker', ['cp', `${cn}:/data/dump.rdb`, file], {}, log);
  } else if (d.engine === 'mongo') {
    // mongodump can write its binary archive straight to a file via
    // --archive=<path> — no shell, no stdout plumbing. Auth is mandatory (the
    // container is initialized with a root user), so credentials travel via
    // argv exactly like the mysqldump path.
    const pass = decrypt(d.passwordEncrypted);
    await run('docker', [
      'exec', cn, 'mongodump',
      '-u', cfg.username()!, '-p', pass, '--authenticationDatabase', 'admin',
      `--archive=${DUMP_TMP}`, '--gzip',
    ], {}, log);
    await run('docker', ['cp', `${cn}:${DUMP_TMP}`, file], {}, log);
    await run('docker', ['exec', cn, 'rm', '-f', DUMP_TMP], {}, swallow);
  } else {
    throw new Error(`backup not supported for ${d.engine}`);
  }
  // Everything on disk is encrypted with the master key: a stolen data dir
  // must not leak the (otherwise encrypted-at-rest) DB credentials via dumps.
  await encryptFileInPlace(file);
}

/**
 * Restore a managed database from `file` (host path). The dump is copied into
 * the container at a static temp path, restored via a file-reading flag, then
 * removed — no host shell, no stdin plumbing, no interpolation. Encrypted
 * backups are transparently decrypted to a temp sibling first; legacy
 * plaintext backups (pre-encryption) restore as-is.
 */
export async function restoreDatabase(d: Database, file: string, log: (line: string) => void): Promise<void> {
  const cfg = ENGINES[d.engine];
  if (!cfg || !d.containerName) throw new Error('database not runnable');
  const cn = d.containerName;
  // Validate the engine BEFORE touching the filesystem so an unsupported engine
  // fails with the right error even for a nonexistent path.
  if (
    d.engine !== 'postgres' &&
    d.engine !== 'mysql' &&
    d.engine !== 'mariadb' &&
    d.engine !== 'mongo' &&
    d.engine !== 'redis' &&
    d.engine !== 'valkey'
  ) {
    throw new Error(`restore not supported for ${d.engine}`);
  }

  const staged = await stageForRestore(file);
  try {
    if (d.engine === 'redis' || d.engine === 'valkey') {
      await run('docker', ['cp', staged.path, `${cn}:/data/dump.rdb`], {}, log);
      await run('docker', ['restart', cn], {}, log);
    } else {
      await run('docker', ['cp', staged.path, `${cn}:${RESTORE_TMP}`], {}, log);
      if (d.engine === 'postgres') {
        await run('docker', ['exec', cn, 'psql', '-U', cfg.username()!, '-d', cfg.dbName()!, '-f', RESTORE_TMP], {}, log);
      } else if (d.engine === 'mysql' || d.engine === 'mariadb') {
        const pass = decrypt(d.passwordEncrypted);
        const client = d.engine === 'mysql' ? 'mysql' : 'mariadb';
        await run('docker', ['exec', cn, client, '-uroot', `--password=${pass}`, '-e', `source ${RESTORE_TMP}`], {}, log);
      } else {
        // mongo
        const pass = decrypt(d.passwordEncrypted);
        await run(
          'docker',
          [
            'exec',
            cn,
            'mongorestore',
            '-u',
            cfg.username()!,
            '-p',
            pass,
            '--authenticationDatabase',
            'admin',
            `--archive=${RESTORE_TMP}`,
            '--gzip',
            '--drop',
          ],
          {},
          log,
        );
      }
    }
  } finally {
    staged.cleanup();
    if (d.engine !== 'redis' && d.engine !== 'valkey') {
      await run('docker', ['exec', cn, 'rm', '-f', RESTORE_TMP], {}, swallow).catch(() => undefined);
    }
  }
}

/** Restart an existing database container. */
export async function restartDatabase(d: Database, log: (line: string) => void): Promise<void> {
  if (!d.containerName) throw new Error('database not runnable');
  await run('docker', ['restart', d.containerName], {}, log);
}

/** Fetch recent logs from the database container. */
export async function databaseLogs(d: Database, lines = 100): Promise<string[]> {
  if (!d.containerName) return [];
  try {
    const raw = await capture('docker', ['logs', '--tail', String(lines), d.containerName]);
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
