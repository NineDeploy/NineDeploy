import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
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

/**
 * Apply all pending migrations (no-op when up to date). Uses Drizzle's runtime
 * migrator so it works in production builds where drizzle-kit is unavailable.
 * Returns the folder the migrations were applied from. `folderOverride` exists
 * for tests and embedders that already know the location.
 */
export async function runMigrations(db: DB, folderOverride?: string): Promise<string> {
  const folder = folderOverride ?? resolveMigrationsFolder();
  if (!folder) {
    throw new Error('Drizzle migrations folder not found — set NINEDEPLOY_MIGRATIONS_DIR');
  }
  await migrate(db, { migrationsFolder: folder });
  return folder;
}
