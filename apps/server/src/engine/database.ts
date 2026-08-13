import type { Database } from '@ninedeploy/db';
import { decrypt } from '../lib/crypto.js';
import { run } from '../lib/exec.js';
import { NETWORK } from './proxy.js';

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

/** Stop + remove a managed database container and its volume (best effort). */
export async function stopDatabase(d: Database, log: (line: string) => void): Promise<void> {
  if (d.containerName) await run('docker', ['rm', '-f', d.containerName], {}, () => {}).catch(() => undefined);
  if (d.volumeName) {
    log(`Removing volume ${d.volumeName} …`);
    await run('docker', ['volume', 'rm', d.volumeName], {}, log).catch(() => undefined);
  }
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
