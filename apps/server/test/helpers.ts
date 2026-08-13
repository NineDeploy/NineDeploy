import { once } from 'node:events';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { DB } from '@ninedeploy/db';
import { forbidden, unauthorized } from '../src/lib/errors.js';
import rawBodyPlugin from '../src/plugins/rawBody.js';

// ── Drizzle table name extraction ─────────────────────────────────────────
const NAME_SYMBOL = Symbol.for('drizzle:Name');

/** Resolve a drizzle table object (or anything) to its SQL table name. */
export function tableName(table: unknown): string {
  const sym = (table as Record<symbol, unknown>)?.[NAME_SYMBOL];
  if (typeof sym === 'string') return sym;
  const fallback = (table as { _?: { name?: string } })?._?.name;
  return typeof fallback === 'string' ? fallback : '?';
}

type Row = Record<string, unknown>;
type RowsResolver = Row[] | ((...args: unknown[]) => Row[] | Promise<Row[]>);
type RowResolver = Row | ((...args: unknown[]) => Row | Promise<Row | undefined>) | undefined;

export interface FakeDbOpts {
  /** Rows returned by db.query.<table>.findMany(args). */
  findMany?: Record<string, RowsResolver>;
  /** Rows returned by db.query.<table>.findFirst(args). */
  findFirst?: Record<string, RowResolver>;
  /** Rows returned by db.select().from(table) (full-row selects). */
  select?: Record<string, Row[]>;
  /** Rows returned by db.select({ n: count() }).from(table). */
  counts?: Record<string, Array<{ n: number }>>;
  /** Rows returned by db.insert(table).values(v).returning(). */
  insert?: Record<string, RowsResolver>;
  /** Rows returned by db.update(table).set(s).where(...).returning(). */
  update?: Record<string, RowsResolver>;
  /** When set, db.select().from(table) rejects with this error (drives catch branches). */
  selectError?: Record<string, Error>;
  /** When true, db.run() rejects (drives health degraded branch). */
  runError?: boolean;
}

/**
 * Build a chainable fake Drizzle DB. Every query family is keyed by table
 * name and falls back to empty/happy-path defaults:
 *   findMany → [], findFirst → undefined, select → [], counts → [],
 *   insert(...).returning() → [values], update(...).returning() → [set].
 */
export function createFakeDb(opts: FakeDbOpts = {}): DB {
  const resolveRows = (v: RowsResolver | undefined, fallback: Row[], ...args: unknown[]): Promise<Row[]> => {
    try {
      const val = typeof v === 'function' ? (v as (...a: unknown[]) => Row[] | Promise<Row[]>)(...args) : v;
      return Promise.resolve(val === undefined ? fallback : val);
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const resolveRow = (v: RowResolver, fallback: Row | undefined, ...args: unknown[]): Promise<Row | undefined> => {
    try {
      const val = typeof v === 'function' ? (v as (...a: unknown[]) => Row | Promise<Row | undefined>)(...args) : v;
      return Promise.resolve(val === undefined ? fallback : val);
    } catch (err) {
      return Promise.reject(err);
    }
  };

  const query = new Proxy({} as Record<string, { findMany: unknown; findFirst: unknown }>, {
    get: (_t, table) => {
      const name = String(table);
      return {
        findMany: (args?: unknown) => {
          // Execute drizzle `orderBy` callback arguments so their arrow bodies
          // count as covered (the real DB would run them).
          const a = (args ?? {}) as { orderBy?: (...x: unknown[]) => unknown };
          if (typeof a.orderBy === 'function') {
            try {
              a.orderBy({}, { desc: () => ({}), asc: () => ({}) });
            } catch {
              /* callback is query-shape only */
            }
          }
          return resolveRows(opts.findMany?.[name], [], args);
        },
        findFirst: (args?: unknown) => resolveRow(opts.findFirst?.[name], undefined, args),
      };
    },
  });

  const select = (cols?: { n?: unknown }) => ({
    from: (table: unknown) => {
      const name = tableName(table);
      const error = opts.selectError?.[name];
      const isCount = cols !== undefined && 'n' in cols;
      const rows: Row[] = isCount ? (opts.counts?.[name] ?? []) : (opts.select?.[name] ?? []);
      const result: {
        then: (ok: (v: unknown) => unknown, rej?: (e: Error) => unknown) => unknown;
        where: () => Promise<Row[]>;
      } = {
        then: (ok, rej) => (error ? (rej ?? (() => {}))(error) : ok(rows)),
        where: () => (error ? Promise.reject(error) : Promise.resolve(rows)),
      };
      return result;
    },
  });

  const insert = (table: unknown) => {
    const name = tableName(table);
    return {
      values: (v: Row) => {
        const rows = () => resolveRows(opts.insert?.[name], [v], v);
        const builder: {
          returning: () => Promise<Row[]>;
          then: (ok: (v?: unknown) => unknown, rej?: (e: Error) => unknown) => unknown;
        } = {
          returning: () => rows(),
          then: (ok, rej) => {
            rows().then(ok, rej);
            return undefined;
          },
        };
        return builder;
      },
    };
  };

  const update = (table: unknown) => {
    const name = tableName(table);
    return {
      set: (s: Row) => ({
        where: () => {
          const rows = () => resolveRows(opts.update?.[name], [s], s);
          const builder: {
            returning: () => Promise<Row[]>;
            then: (ok: (v?: unknown) => unknown, rej?: (e: Error) => unknown) => unknown;
          } = {
            returning: () => rows(),
            then: (ok, rej) => {
              rows().then(ok, rej);
              return undefined;
            },
          };
          return builder;
        },
      }),
    };
  };

  const del = (_table: unknown) => ({
    where: () => ({
      then: (ok: (v?: unknown) => unknown, rej?: (e: Error) => unknown) => {
        ok(undefined);
        return undefined;
      },
    }),
  });

  const run = () => ({
    then: (ok: (v?: unknown) => unknown, rej: (e: Error) => unknown) =>
      opts.runError ? rej(new Error('db unavailable')) : ok(undefined),
  });

  return { query, select, insert, update, delete: del, run } as unknown as DB;
}

// ── Fastify test app ──────────────────────────────────────────────────────

export interface TestAppOpts {
  db?: DB;
  /** Result of app.stats.raw(). */
  stats?: { containers: Map<string, unknown>; host: unknown };
  /** Register @fastify/websocket (needed for WS routes). */
  websocket?: boolean;
  /** Register the rawBody content-type parsers (needed for webhook/import routes). */
  rawBody?: boolean;
}

/**
 * Build a bare Fastify app with the decorations the module routes rely on:
 *   - `user` request decoration (null) + an `authenticate` pre-handler that
 *     reads the `x-test-user` header (throws 401 when absent)
 *   - `db` (fake) and `stats` decorations
 *   - the same error envelope app.ts produces (ZodError → 400, HttpError → status)
 */
export async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (opts.rawBody) await app.register(rawBodyPlugin);
  if (opts.websocket) await app.register(websocket);

  app.decorateRequest('user', null);
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers['x-test-user'];
    if (!header) throw unauthorized();
    // Role comes from an `x-test-role` header (default 'admin' so existing tests
    // that don't care about RBAC keep working as privileged users).
    const role = (req.headers['x-test-role'] === 'member' ? 'member' : 'admin') as 'admin' | 'member';
    req.user = { id: Number(header), role };
    void reply;
  });
  app.decorate('requireAdmin', async (req: FastifyRequest) => {
    if (!req.user || req.user.role !== 'admin') throw forbidden('Admin access required');
  });
  app.decorate('db', opts.db ?? createFakeDb());
  app.decorate('stats', {
    raw: () => opts.stats ?? { containers: new Map<string, unknown>(), host: null },
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'validation_error', message: 'Request validation failed', details: err.flatten() },
      });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    return reply.status(status).send({
      error: { code: err.code ?? 'internal_error', message: err.message },
    });
  });

  return app;
}

// ── Request/WS helpers ────────────────────────────────────────────────────

/** Headers that make the test `authenticate` stub resolve to a user id. */
export const asUser = (id = 1): Record<string, string> => ({ 'x-test-user': String(id) });

/** Start the app on an ephemeral port and return the port. */
export async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('app is not listening on a TCP port');
  return addr.port;
}

export const wsUrl = (port: number, path: string): string => `ws://127.0.0.1:${port}${path}`;

/** Open a WebSocket and wait for the open handshake. */
export async function openWs(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  return ws;
}

/** Collect text messages as they arrive. */
export function collectMessages(ws: WebSocket): string[] {
  const messages: string[] = [];
  ws.addEventListener('message', (ev: MessageEvent) => {
    messages.push(typeof ev.data === 'string' ? ev.data : String(ev.data));
  });
  return messages;
}

/** Poll until `pred` is truthy or the timeout elapses. */
export async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ── Row fixtures (mirror packages/db/src/schema.ts shapes) ────────────────

export const NOW = new Date('2026-01-01T00:00:00.000Z');

export const userRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  email: 'admin@example.com',
  passwordHash: 'hash',
  name: 'Admin',
  role: 'admin',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const svcRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  projectId: null,
  name: 'web',
  slug: 'web',
  type: 'docker',
  status: 'idle',
  repoUrl: null,
  branch: 'main',
  commitSha: null,
  sourceId: null,
  image: null,
  volumeMount: null,
  port: 3000,
  healthPath: '/',
  runtimeId: null,
  cpuShares: 0,
  memLimitMb: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  projectId: null,
  name: 'pg',
  slug: 'pg',
  engine: 'postgres',
  version: '16',
  status: 'running',
  containerName: 'nd-db-pg',
  internalHost: 'nd-db-pg',
  internalPort: 5432,
  username: 'nine',
  passwordEncrypted: '',
  dbName: 'app',
  volumeName: 'nd-db-pg-data',
  cpuShares: 0,
  memLimitMb: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const depRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  status: 'running',
  commitSha: 'abcdef1',
  message: 'deploy',
  author: 'alice',
  trigger: 'user',
  logPath: null,
  startedAt: NOW,
  finishedAt: null,
  createdAt: NOW,
  ...over,
});

export const domainRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  hostname: 'app.example.com',
  path: '/',
  ssl: false,
  redirectWww: false,
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const backupRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  databaseId: 1,
  scope: 'db',
  status: 'completed',
  path: '/tmp/nonexistent.dump',
  sizeBytes: 100,
  createdAt: NOW,
  ...over,
});

export const envVarRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  key: 'PORT',
  valueEncrypted: '',
  isSecret: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const webhookRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  sourceId: null,
  serviceId: 1,
  branch: 'main',
  events: ['push'],
  secretEncrypted: '',
  active: true,
  createdAt: NOW,
  ...over,
});

export const tokenRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 1,
  name: 'cli',
  hash: 'h',
  scopes: [],
  lastUsedAt: null,
  expiresAt: null,
  createdAt: NOW,
  ...over,
});

export const tunnelRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'prod',
  slug: 'prod-0001',
  tokenEncrypted: '',
  status: 'running',
  containerName: 'nd-tunnel-prod-0001',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const sourceRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  type: 'github',
  name: 'repo',
  tokenEncrypted: null,
  deployKeyEncrypted: null,
  defaultBranch: 'main',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const channelRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'ops',
  type: 'telegram',
  targetEncrypted: '',
  eventFilter: '',
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const notifLogRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  channelId: 1,
  event: 'deploy.completed',
  entity: null,
  status: 'sent',
  error: null,
  ts: NOW,
  ...over,
});

export const attachmentRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  databaseId: 1,
  envAlias: 'DATABASE_URL',
  createdAt: NOW,
  ...over,
});

export const auditRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 1,
  action: 'service.create',
  entity: 'web',
  meta: null,
  ts: NOW,
  ...over,
});

export const metricRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  kind: 'cpu',
  value: 5,
  ts: NOW,
  ...over,
});

export const buildConfigRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  buildPack: 'auto',
  baseDir: '/',
  installCmd: null,
  buildCmd: null,
  startCmd: null,
  dockerfilePath: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
