import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DB } from './client.js';

/**
 * Pick the first candidate folder that carries the Drizzle journal
 * (meta/_journal.json). Pure and injectable so the selection logic is testable
 * without moving real directories around.
 */
export function pickMigrationsFolder(candidates: Array<string | undefined>): string | null {
  for (const c of candidates) {
    if (c && existsSync(path.join(c, 'meta', '_journal.json'))) return c;
  }
  return null;
}

/**
 * Resolve the SQL migrations folder at runtime. The server applies migrations
 * itself on startup (containers have no drizzle-kit — it's a devDependency),
 * so the folder must be locatable from every execution context:
 *   1. NINEDEPLOY_MIGRATIONS_DIR env override
 *   2. compiled layout: packages/db/dist/migrate.js -> ../src/migrations
 *   3. source layout:   packages/db/src/migrate.js  -> ./migrations
 *   4. cwd at a monorepo root or at the package root (dev shell / container)
 */
export function resolveMigrationsFolder(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return pickMigrationsFolder([
    process.env['NINEDEPLOY_MIGRATIONS_DIR'],
    path.resolve(here, '../src/migrations'), // compiled (dist)
    path.resolve(here, 'migrations'), // running from source
    path.resolve('packages/db/src/migrations'), // cwd at a monorepo root
    path.resolve('src/migrations'), // cwd at the package root
  ]);
}

const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Errors meaning "this schema object is already there". They are the signature
 * of a database whose schema was patched outside the journal — see
 * `applyToleratingExistingObjects`.
 */
const ALREADY_APPLIED = /duplicate column name|already exists/i;

/** True for an error that only reports an object the migration wanted to add. */
function isAlreadyApplied(err: unknown): boolean {
  return ALREADY_APPLIED.test(err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : String(err));
}

/**
 * Re-apply the pending migrations one statement at a time, skipping the ones
 * whose object already exists, then record each migration in the journal.
 *
 * Why this exists: releases up to 0.2.36 patched a handful of columns into an
 * existing database at boot (`ensureEssentialColumns` in the server's db
 * plugin) *before* an equivalent SQL migration existed. On those installs the
 * column is present but the migration that adds it was never journalled, so
 * Drizzle's batch migrator aborts the whole upgrade with
 * `duplicate column name: owner_user_id` and the panel never starts.
 *
 * Skipping is deliberately narrow: only "already exists" failures are ignored,
 * and every other error still aborts the upgrade.
 */
async function applyToleratingExistingObjects(db: DB, folder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  await db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
    ),
  );
  const rows = await db.all<{ created_at: number | null }>(
    sql.raw(`SELECT created_at FROM \`${MIGRATIONS_TABLE}\` ORDER BY created_at DESC LIMIT 1`),
  );
  // Resume from the high-water mark. This is correct because of WHERE we are
  // called from: Drizzle's own migrator resumes the same way, so by the time it
  // has thrown an "already exists" error the migrations it could not journal
  // are, by construction, the newest ones. (A journal missing an INTERIOR entry
  // reads as up-to-date to Drizzle, which then never throws and never reaches
  // this function at all — so a hash-set resume here would change nothing.)
  const lastApplied = Number(rows[0]?.created_at ?? 0);

  for (const migration of migrations) {
    if (migration.folderMillis <= lastApplied) continue;
    for (const statement of migration.sql) {
      try {
        await db.run(sql.raw(statement));
      } catch (err) {
        if (!isAlreadyApplied(err)) throw err;
      }
    }
    await db.run(
      sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") VALUES(${migration.hash}, ${migration.folderMillis})`,
    );
  }
}

/**
 * Apply all pending migrations (no-op when up to date). Uses Drizzle's runtime
 * migrator so it works in production builds where drizzle-kit is unavailable.
 * Returns the folder the migrations were applied from. `folderOverride` exists
 * for tests and embedders that already know the location.
 *
 * A batch that fails only because an object already exists is retried
 * statement by statement — see `applyToleratingExistingObjects`.
 */
export async function runMigrations(db: DB, folderOverride?: string): Promise<string> {
  const folder = folderOverride ?? resolveMigrationsFolder();
  if (!folder) {
    throw new Error('Drizzle migrations folder not found — set NINEDEPLOY_MIGRATIONS_DIR');
  }
  try {
    await migrate(db, { migrationsFolder: folder });
  } catch (err) {
    if (!isAlreadyApplied(err)) throw err;
    await applyToleratingExistingObjects(db, folder);
  }
  return folder;
}
