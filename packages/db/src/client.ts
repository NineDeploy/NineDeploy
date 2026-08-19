import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type DB = LibSQLDatabase<typeof schema>;
export type Schema = typeof schema;

export interface CreateDbOptions {
  /** libSQL URL. Use `file:<path>` for a local SQLite file. */
  url: string;
  /** Auth token (only relevant for remote/libSQL servers). */
  authToken?: string;
  /** Return the raw libSQL client as well (needed by the migrator). */
  withClient?: boolean;
}

export interface CreateDbResult {
  db: DB;
  client: Client;
}

/**
 * Create a Drizzle-backed database connection backed by libSQL (local file by default).
 *
 * @example
 * const { db } = createDb({ url: 'file:./.data/ninedeploy.db' });
 */
export function createDb(opts: CreateDbOptions): CreateDbResult {
  /* v8 ignore start */
  if (opts.url.startsWith('file:')) {
    const raw = opts.url.slice('file:'.length);
    mkdirSync(path.dirname(path.resolve(raw)), { recursive: true });
  }
  /* v8 ignore stop */
  const client = createClient({ url: opts.url, authToken: opts.authToken });
  // SQLite defaults `foreign_keys` to OFF, which would silently disable every
  // `onDelete cascade` / `set null` rule declared in the schema. Enable it per
  // connection. Fired without awaiting — execute calls on a single libSQL client
  // are serialized, so this runs before any subsequent query on this connection.
  // busy_timeout: without it a reader/writer that collides with the deploy
  // worker's write fails immediately with SQLITE_BUSY; 5s lets it wait.
  // journal_mode=WAL is DELIBERATELY not enabled: the system export handler and
  // install.sh's pre-update backup tar only the single ninedeploy.db file, so
  // WAL would leave recent committed state in ninedeploy.db-wal and silently
  // drop it from those archives. If WAL is ever wanted, the export/import
  // handlers and install.sh backup must first wal_checkpoint(TRUNCATE) or
  // include the sidecar files.
  void client
    .execute('PRAGMA foreign_keys = ON;')
    .then(() => client.execute('PRAGMA busy_timeout = 5000;'))
    .catch(() => undefined);
  const db = drizzle(client, { schema });
  return { db, client };
}
