import { writeFileSync } from 'node:fs';
import type { Database } from '@ninedeploy/db';
import { decrypt } from '../lib/crypto.js';
import { capture, run } from '../lib/exec.js';
import { NETWORK } from './proxy.js';

const swallow = () => {};
/** Static temp paths used inside managed containers for backup/restore staging. */
const DUMP_TMP = '/tmp/ninedeploy-dump';
const RESTORE_TMP = '/tmp/ninedeploy-restore';

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

/** Run a managed database container on the shared network with a persistent volume. */
export async function startDatabase(d: Database, log: (line: string) => void): Promise<void> {
  const cfg = ENGINES[d.engine];
  if (!cfg) throw new Error(`Unknown engine: ${d.engine}`);
  if (!d.containerName || !d.volumeName) throw new Error('database has no container/volume name');

  // Detect a retained volume from a previous deployment of the same name → its
  // data will be reused automatically by Docker (the volume bind is idempotent).
  if (await volumeExists(d.volumeName)) {
    log(`Reusing retained volume ${d.volumeName} (previous data restored)`);
  }

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
    // mongodump emits a binary archive on stdout; redirect it to a static temp
    // path inside the container (no interpolation), then copy the file out.
    await run('docker', ['exec', cn, 'sh', '-c', `mongodump --archive --gzip > ${DUMP_TMP}`], {}, log);
    await run('docker', ['cp', `${cn}:${DUMP_TMP}`, file], {}, log);
    await run('docker', ['exec', cn, 'rm', '-f', DUMP_TMP], {}, swallow);
  } else {
    throw new Error(`backup not supported for ${d.engine}`);
  }
}

/**
 * Restore a managed database from `file` (host path). The dump is copied into
 * the container at a static temp path, restored via a file-reading flag, then
 * removed — no host shell, no stdin plumbing, no interpolation.
 */
export async function restoreDatabase(d: Database, file: string, log: (line: string) => void): Promise<void> {
  const cfg = ENGINES[d.engine];
  if (!cfg || !d.containerName) throw new Error('database not runnable');
  const cn = d.containerName;
  if (d.engine === 'redis') throw new Error('restore not supported for redis');

  await run('docker', ['cp', file, `${cn}:${RESTORE_TMP}`], {}, log);
  try {
    if (d.engine === 'postgres') {
      await run('docker', ['exec', cn, 'psql', '-U', cfg.username()!, '-d', cfg.dbName()!, '-f', RESTORE_TMP], {}, log);
    } else if (d.engine === 'mysql') {
      const pass = decrypt(d.passwordEncrypted);
      await run('docker', ['exec', cn, 'mysql', '-uroot', `--password=${pass}`, '-e', `source ${RESTORE_TMP}`], {}, log);
    } else if (d.engine === 'mongo') {
      await run('docker', ['exec', cn, 'mongorestore', `--archive=${RESTORE_TMP}`, '--gzip', '--drop'], {}, log);
    } else {
      throw new Error(`restore not supported for ${d.engine}`);
    }
  } finally {
    await run('docker', ['exec', cn, 'rm', '-f', RESTORE_TMP], {}, swallow).catch(() => undefined);
  }
}
