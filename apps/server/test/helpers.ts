import { once } from 'node:events';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, vi } from 'vitest';
import { ZodError } from 'zod';
import type { DB } from '@ninedeploy/db';
import { forbidden, unauthorized } from '../src/lib/errors.js';
import rawBodyPlugin from '../src/plugins/rawBody.js';
import { NineDeployKernel } from '../src/kernel/kernel.js';
import { config } from '../src/config.js';

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
  /**
   * Rows returned by db.select().from(table) (full-row selects).
   *
   * The fake db does not evaluate `where` predicates, so a route that scopes
   * by re-querying with a narrower projection (`select({ id: services.id })
   * .from(services).where(eq(services.ownerUserId, ...))`) cannot be modelled
   * by a static row list. Pass a function to branch on the projection: it
   * receives the selected columns (`undefined` for a full-row select).
   */
  select?: Record<string, Row[] | ((cols: unknown) => Row[])>;
  /** Rows returned by db.select({ n: count() }).from(table). */
  counts?: Record<string, Array<{ n: number }>>;
  /** Rows returned by db.insert(table).values(v).returning(). */
  insert?: Record<string, RowsResolver>;
  /** Rows returned by db.update(table).set(s).where(...).returning(). */
  update?: Record<string, RowsResolver>;
  /** Rows returned by db.delete(table).where(...).returning(). */
  delete?: Record<string, RowsResolver>;
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
/**
 * Authorization is workspace-derived: `isOperator()` asks the DB whether the
 * caller holds an owner/admin seat anywhere, so a fake DB with no
 * `workspace_members` rows makes every caller a non-operator and turns every
 * resource guard into a 404. `asUser()` defaults to user 1 as an operator, so
 * the fake DB gives *that* user one owner seat by default.
 *
 * The seat is deliberately scoped to user 1: negative tests sign in as a
 * different id (`asUser({ id: 7, isOperator: false })`) and must still be
 * treated as a plain member. Tests that need user 1 to be a non-operator
 * override `findMany.workspaceMembers` explicitly (usually with `() => []`).
 */
const DEFAULT_OPERATOR_USER_ID = 1;

const DEFAULT_MEMBERSHIP: Row = {
  id: 1,
  workspaceId: 1,
  userId: DEFAULT_OPERATOR_USER_ID,
  role: 'owner',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

/** Pull the bound user id out of a drizzle `eq(workspaceMembers.userId, n)`. */
function boundUserId(args: unknown): number | null {
  const chunks = (args as { where?: { queryChunks?: unknown[] } } | undefined)?.where?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown } | null)?.value;
    if (typeof value === 'number') return value;
  }
  return null;
}

function defaultRows(table: string, args: unknown): Row[] {
  if (table !== 'workspaceMembers' && table !== 'workspace_members') return [];
  const userId = boundUserId(args);
  return userId === null || userId === DEFAULT_OPERATOR_USER_ID ? [DEFAULT_MEMBERSHIP] : [];
}


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
          // Execute drizzle `orderBy`/`where` callback arguments so their arrow
          // bodies count as covered (the real DB would run them).
          const a = (args ?? {}) as {
            orderBy?: (...x: unknown[]) => unknown;
            where?: (...x: unknown[]) => unknown;
          };
          if (typeof a.orderBy === 'function') {
            try {
              a.orderBy({}, { desc: () => ({}), asc: () => ({}) });
            } catch {
              /* callback is query-shape only */
            }
          }
          if (typeof a.where === 'function') {
            try {
              a.where({}, { eq: () => ({}) });
            } catch {
              /* callback is query-shape only */
            }
          }
          const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
          const target = opts.findMany?.[name] !== undefined ? opts.findMany[name] : opts.findMany?.[snake];
          return resolveRows(target, defaultRows(name, args), args);
        },
        findFirst: (args?: unknown) => {
          const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
          const target = opts.findFirst?.[name] !== undefined ? opts.findFirst[name] : opts.findFirst?.[snake];
          return resolveRow(target, undefined, args);
        },
      };
    },
  });

  const select = (cols?: { n?: unknown }) => ({
    from: (table: unknown) => {
      const name = tableName(table);
      const error = opts.selectError?.[name];
      const isCount = cols !== undefined && 'n' in cols;
      const configured = isCount ? opts.counts?.[name] : opts.select?.[name];
      const rows: Row[] = typeof configured === 'function' ? configured(cols) : (configured ?? []);
      // A chainable thenable: `await`, `.where(...)`, `.leftJoin(...)`,
      // `.limit(...)` and `.orderBy(...)` all resolve to the configured rows,
      // mirroring drizzle's query-builder shapes.
      const chain: Record<string, unknown> = {};
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable — the fake DB query result must be awaitable by the code under test.
      chain.then = (ok: (v: unknown) => unknown, rej?: (e: Error) => unknown) =>
        error ? (rej ?? (() => {}))(error) : ok(rows);
      for (const step of ['where', 'leftJoin', 'innerJoin', 'limit', 'orderBy']) {
        chain[step] = vi.fn(() => chain);
      }
      return chain;
    },
  });

  const insert = (table: unknown) => {
    const name = tableName(table);
    return {
      values: (v: Row) => {
        const rows = () => resolveRows(opts.insert?.[name], [v], v);
        const builder: {
          returning: () => Promise<Row[]>;
          onConflictDoUpdate: () => Promise<Row[]>;
          onConflictDoNothing: () => Promise<Row[]>;
          then: (ok: (v?: unknown) => unknown, rej?: (e: Error) => unknown) => unknown;
        } = {
          returning: () => rows(),
          // Settings-style upserts resolve like a plain insert in the fake.
          onConflictDoUpdate: () => rows(),
          // Idempotent link-table inserts (service_projects, service_workspaces,
          // service_labels) resolve the same way.
          onConflictDoNothing: () => rows(),
          // biome-ignore lint/suspicious/noThenProperty: intentional thenable — the fake DB insert result must be awaitable by the code under test.
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
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable — the fake DB update result must be awaitable by the code under test.
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

  const del = (table: unknown) => {
    const name = tableName(table);
    return {
      where: () => {
        const rows = () => resolveRows(opts.delete?.[name], [{ id: 1 }]);
        const builder: {
          returning: () => Promise<Row[]>;
          then: (ok: (v?: unknown) => unknown, _rej?: (e: Error) => unknown) => unknown;
        } = {
          returning: () => rows(),
          // biome-ignore lint/suspicious/noThenProperty: intentional thenable — the fake DB delete result must be awaitable by the code under test.
          then: (ok) => {
            rows().then(() => ok(undefined));
            return undefined;
          },
        };
        return builder;
      },
    };
  };

  const run = () => ({
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable — the fake DB run result must be awaitable by the code under test.
    then: (ok: (v?: unknown) => unknown, rej: (e: Error) => unknown) =>
      opts.runError ? rej(new Error('db unavailable')) : ok(undefined),
  });

  const dbish = { query, select, insert, update, delete: del, run };
  return {
    ...dbish,
    // Drizzle-style transaction: runs the callback against the same fake db
    // (single-connection fake — no isolation semantics needed for route tests).
    transaction: async <T>(fn: (tx: typeof dbish) => Promise<T>): Promise<T> => fn(dbish),
  } as unknown as DB;
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
    // `x-test-operator` overrides the role-derived default so tests can pin
    // the new `isOperator` flag directly (e.g. operator-vs-member cases that
    // don't care about a specific workspace seat). The legacy `x-test-role`
    // still works for older call sites.
    const explicit = req.headers['x-test-operator'];
    const role = (req.headers['x-test-role'] === 'member' ? 'member' : 'admin') as 'admin' | 'member';
    const isOperator =
      explicit === 'true' ? true : explicit === 'false' ? false : role === 'admin';
    // `tokenScopes: null` = an interactive session, i.e. unrestricted. Tests
    // that exercise API-token scoping set it explicitly.
    const scopeHeader = req.headers['x-test-token-scopes'];
    const tokenScopes =
      typeof scopeHeader === 'string' ? scopeHeader.split(',').filter(Boolean) : null;
    req.user = { id: Number(header), role, isOperator, tokenScopes };
    void reply;
  });
  app.decorate('requireAdmin', async (req: FastifyRequest) => {
    if (req.user?.isOperator !== true) throw forbidden('Admin access required');
  });
  // The new operator check (legacy `requireAdmin` is kept as an alias).
  app.decorate('requireOperator', async (req: FastifyRequest) => {
    if (req.user?.isOperator !== true) throw forbidden('Operator access required');
  });
  const testDb = opts.db ?? createFakeDb();
  app.decorate('db', testDb);
  const testKernel = new NineDeployKernel(testDb, config);
  app.decorate('kernel', testKernel);
  app.decorateRequest('kernel', {
    getter() {
      return (this as unknown as { server: FastifyInstance }).server?.kernel ?? testKernel;
    },
  });
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

  openApps.add(app);
  return app;
}

/**
 * Every app `buildTestApp` hands out, closed after the test that made it.
 *
 * Files that build one Fastify instance per test used to leave all of them
 * open — 50+ live servers, each with its own kernel, plugin state and (in the
 * websocket tests) sockets, all still attached to the worker's event loop and
 * still able to emit through its IPC channel. On Windows that reliably wedged
 * the fork partway through a large file: the run reported N of M tests and
 * then stopped for good, at a different N each time.
 */
const openApps = new Set<FastifyInstance>();

afterEach(async () => {
  const apps = [...openApps];
  openApps.clear();
  await Promise.all(apps.map((a) => a.close().catch(() => undefined)));
});

// ── Request/WS helpers ────────────────────────────────────────────────────

/** Headers that make the test `authenticate` stub resolve to a user id. */
export const asUser = (
  idOrOpts: number | { id?: number; role?: 'admin' | 'member'; isOperator?: boolean } = 1,
): Record<string, string> => {
  if (typeof idOrOpts === 'object' && idOrOpts !== null) {
    const role = idOrOpts.role ?? (idOrOpts.isOperator === false ? 'member' : 'admin');
    const headers: Record<string, string> = {
      'x-test-user': String(idOrOpts.id ?? 1),
      'x-test-role': role,
    };
    if (idOrOpts.isOperator !== undefined) headers['x-test-operator'] = String(idOrOpts.isOperator);
    return headers;
  }
  return { 'x-test-user': String(idOrOpts), 'x-test-role': 'admin' };
};

/** Start the app on an ephemeral port and return the port. */
export async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('app is not listening on a TCP port');
  return addr.port;
}

export const wsUrl = (port: number, path: string): string => `ws://127.0.0.1:${port}${path}`;

/** Open a WebSocket and wait for the open handshake. */
export async function openWs(url: string, protocols?: string | string[]): Promise<WebSocket> {
  const ws = new WebSocket(url, protocols);
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
  isOperator: true,
  isInstanceOperator: true,
  tokenVersion: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

/** A live session row backing a refresh token (matches lib/sessions.ts). */
export const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 1,
  jti: 'jti-1',
  ip: '127.0.0.1',
  userAgent: 'vitest',
  createdAt: NOW,
  lastUsedAt: NOW,
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  ...over,
});

/** Record every payload written through db.update(...) — for asserting which
 * statuses a code path actually persisted, independent of the fake's resolvers. */
export function trackStatusUpdates(db: ReturnType<typeof createFakeDb>) {
  const updates: Array<Record<string, unknown>> = [];
  const original = db.update.bind(db) as (table: unknown) => {
    set: (payload: Record<string, unknown>) => unknown;
  };
  (
    db as unknown as {
      update: (table: unknown) => { set: (payload: Record<string, unknown>) => unknown };
    }
  ).update = (table: unknown) => ({
    set: (payload: Record<string, unknown>) => {
      updates.push(payload);
      return original(table).set(payload);
    },
  });
  return { updates };
}

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
  composeService: null,
  port: 3000,
  healthPath: '/',
  runtimeId: null,
  cpuShares: 0,
  memLimitMb: 0,
  publishedPort: null,
  previewDeploymentsEnabled: false,
  previewAutoDestroyOnClose: true,
  previewDomainPattern: null,
  previewMaxActive: 5,
  isEphemeralPreview: false,
  previewParentServiceId: null,
  prNumber: null,
  createdAt: NOW,
  updatedAt: NOW,
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
  preDeployCmd: null,
  postDeployCmd: null,
  preStopCmd: null,
  restartPolicy: 'unless-stopped',
  stopGraceSeconds: 5,
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
  webGuiEnabled: false,
  webGuiPort: null,
  extensions: [],
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
  headers: null,
  basicAuth: null,
  ipAllowlist: null,
  rateLimitAverage: null,
  rateLimitBurst: null,
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

export const jobRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  serviceId: 1,
  name: 'job',
  cron: '0 3 * * *',
  kind: 'deploy',
  command: null,
  enabled: true,
  lastRunAt: null,
  createdAt: NOW,
  updatedAt: NOW,
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
  registryUsername: null,
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
  // G-18 PR-A: null on channels created before Discord gained the embed
  // knobs. Tests that exercise the new field override this directly.
  configJson: null,
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
  attempts: 2,
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

export const drainRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Datadog Prod',
  type: 'datadog',
  url: 'https://http-intake.logs.datadoghq.com',
  apiKeyEncrypted: null,
  serviceId: null,
  enabled: true,
  format: 'json',
  headersJson: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});


