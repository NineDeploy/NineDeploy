import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Database } from '@ninedeploy/db';
import { decrypt, encrypt } from '../lib/crypto.js';
import { capture, run } from '../lib/exec.js';
import { NETWORK } from './proxy.js';

const swallow = () => {};
/** Static temp paths used inside managed containers for backup/restore staging. */
const DUMP_TMP = '/tmp/ninedeploy-dump';
const RESTORE_TMP = '/tmp/ninedeploy-restore';

/** Matches a versioned secret envelope ("v<ver>:…"). Backups written since the
 *  encryption change carry this prefix; anything else is a legacy plaintext dump. */
const ENVELOPE_RE = /^v\d+:/;

/**
 * Encrypt a backup file in place (master-key envelope over base64-encoded dump
 * content — binary-safe). Plain dumps on disk would leak every DB credential
 * they contain to anyone who steals the data directory, defeating the at-rest
 * encryption of the credentials themselves.
 */
function encryptFileInPlace(file: string): void {
  const plain = readFileSync(file).toString('base64');
  writeFileSync(file, encrypt(plain), { mode: 0o600 });
}

/** Read a backup file and return its PLAINTEXT bytes (envelope-aware). */
export function readBackupBytes(file: string): Buffer {
  const raw = readFileSync(file, 'utf8');
  const payload = ENVELOPE_RE.test(raw) ? decrypt(raw) : raw; // legacy = plaintext
  return Buffer.from(payload, 'base64');
}

/**
 * Prepare a backup file for restore: encrypted backups are decrypted to a
 * sibling temp file; legacy plaintext files are used as-is. Returns the path to
 * feed to `docker cp` and a cleanup function.
 */
function stageForRestore(file: string): { path: string; cleanup: () => void } {
  const head = readFileSync(file, 'utf8').slice(0, 32);
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
  username: () => string | undefined;
  dbName: () => string | undefined;
  connectionString: (host: string, port: number, user: string, password: string, dbName: string | undefined) => string;
}

export const ENGINES: Record<string, EngineConfig> = {
  postgres: {
    image: (v) => `postgres:${v || '16'}`,
    port: 5432,
    volumePath: '/var/lib/postgresql/data',
    env: (p) => ({ POSTGRES_USER: 'nine', POSTGRES_PASSWORD: p, POSTGRES_DB: 'app' }),
    username: () => 'nine',
    dbName: () => 'app',
    connectionString: (h, prt, u, p, d) => `postgres://${u}:${p}@${h}:${prt}/${d}`,
  },
  mysql: {
    image: (v) => `mysql:${v || '8'}`,
    port: 3306,
    volumePath: '/var/lib/mysql',
    env: (p) => ({ MYSQL_ROOT_PASSWORD: p }),
    username: () => 'root',
    dbName: () => undefined,
    connectionString: (h, prt, u, p) => `mysql://${u}:${p}@${h}:${prt}/`,
  },
  redis: {
    image: (v) => `redis:${v || '7'}`,
    port: 6379,
    volumePath: '/data',
    env: () => ({}),
    username: () => undefined,
    dbName: () => undefined,
    connectionString: (h, prt) => `redis://${h}:${prt}`,
  },
  mongo: {
    image: (v) => `mongo:${v || '7'}`,
    port: 27017,
    volumePath: '/data/db',
    env: (p) => ({ MONGO_INITDB_ROOT_USERNAME: 'nine', MONGO_INITDB_ROOT_PASSWORD: p }),
    username: () => 'nine',
    dbName: () => undefined,
    connectionString: (h, prt, u, p) => `mongodb://${u}:${p}@${h}:${prt}`,
  },
};

/** Whether a container exists and is currently in the `running` state. */
async function containerRunning(name: string): Promise<boolean> {
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
  for (const [k, v] of Object.entries(cfg.env(password))) args.push('-e', `${k}=${v}`);
  args.push(cfg.image(d.version ?? undefined));

  log(`Starting ${d.engine} database ${d.name} (${d.containerName}) …`);
  await run('docker', args, {}, log);
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
    if (d.engine === 'redis') {
      const out = await capture('docker', ['exec', d.containerName, 'redis-cli', 'INFO', 'memory']);
      const m = /used_memory:(\d+)/.exec(out);
      return m ? Number(m[1]) : 0;
    }
    if (d.engine === 'mysql') {
      const pass = decrypt(d.passwordEncrypted);
      const out = await capture('docker', [
        'exec', d.containerName, 'mysql', '-uroot', `--password=${pass}`, '-N',
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
    const dump = await capture('docker', ['exec', cn, 'pg_dump', '-U', cfg.username()!, '-d', cfg.dbName()!]);
    writeFileSync(file, dump);
  } else if (d.engine === 'mysql') {
    const pass = decrypt(d.passwordEncrypted);
    const dump = await capture('docker', ['exec', cn, 'mysqldump', '-uroot', `--password=${pass}`, '--all-databases']);
    writeFileSync(file, dump);
  } else if (d.engine === 'redis') {
    await run('docker', ['exec', cn, 'redis-cli', 'SAVE'], {}, log);
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
  encryptFileInPlace(file);
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
  if (d.engine !== 'postgres' && d.engine !== 'mysql' && d.engine !== 'mongo') {
    throw new Error(`restore not supported for ${d.engine}`);
  }

  const staged = stageForRestore(file);
  await run('docker', ['cp', staged.path, `${cn}:${RESTORE_TMP}`], {}, log);
  try {
    if (d.engine === 'postgres') {
      await run('docker', ['exec', cn, 'psql', '-U', cfg.username()!, '-d', cfg.dbName()!, '-f', RESTORE_TMP], {}, log);
    } else if (d.engine === 'mysql') {
      const pass = decrypt(d.passwordEncrypted);
      await run('docker', ['exec', cn, 'mysql', '-uroot', `--password=${pass}`, '-e', `source ${RESTORE_TMP}`], {}, log);
    } else {
      // mongo (the engine union was pre-validated above); same auth rules as
      // the backup path.
      const pass = decrypt(d.passwordEncrypted);
      await run('docker', ['exec', cn, 'mongorestore', '-u', cfg.username()!, '-p', pass, '--authenticationDatabase', 'admin', `--archive=${RESTORE_TMP}`, '--gzip', '--drop'], {}, log);
    }
  } finally {
    staged.cleanup();
    await run('docker', ['exec', cn, 'rm', '-f', RESTORE_TMP], {}, swallow).catch(() => undefined);
  }
}
