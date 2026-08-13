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
  const client = createClient({ url: opts.url, authToken: opts.authToken });
  // SQLite defaults `foreign_keys` to OFF, which would silently disable every
  // `onDelete cascade` / `set null` rule declared in the schema. Enable it per
  // connection. Fired without awaiting — execute calls on a single libSQL client
  // are serialized, so this runs before any subsequent query on this connection.
  void client.execute('PRAGMA foreign_keys = ON;').catch(() => undefined);
  const db = drizzle(client, { schema });
  return { db, client };
}
