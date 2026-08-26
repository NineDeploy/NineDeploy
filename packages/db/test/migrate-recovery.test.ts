import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

const migrationsFolder = fileURLToPath(new URL('../src/migrations', import.meta.url));

/**
 * Reproduces the upgrade state left by releases up to 0.2.36: the server's
 * `ensureEssentialColumns` boot hook patched `databases.owner_user_id` into
 * the live schema before a matching SQL migration existed, so on upgrade the
 * column is present while its migration is still unjournalled. Drizzle's batch
 * migrator aborts that whole upgrade with `duplicate column name`.
 */
async function migratedDbWithLastMigrationUnjournalled() {
  const { db } = createDb({ url: ':memory:' });
  await runMigrations(db, migrationsFolder);

  const before = await db.all<{ hash: string; created_at: number }>(
    sql.raw('SELECT hash, created_at FROM `__drizzle_migrations` ORDER BY created_at DESC'),
  );
  // Forget the newest migration while keeping the objects it created.
  await db.run(
    sql.raw(
      'DELETE FROM `__drizzle_migrations` WHERE created_at = (SELECT MAX(created_at) FROM `__drizzle_migrations`)',
    ),
  );
  return { db, before };
}

describe('runMigrations recovery', () => {
  it('completes an upgrade whose objects already exist outside the journal', async () => {
    const { db, before } = await migratedDbWithLastMigrationUnjournalled();

    // Without the recovery path this rejects with `duplicate column name`.
    await expect(runMigrations(db, migrationsFolder)).resolves.toBe(migrationsFolder);

    const after = await db.all<{ hash: string; created_at: number }>(
      sql.raw('SELECT hash, created_at FROM `__drizzle_migrations` ORDER BY created_at DESC'),
    );
    // The journal is whole again: the migration is recorded exactly once.
    expect(after).toHaveLength(before.length);
    expect(after[0]?.hash).toBe(before[0]?.hash);
    expect(after[0]?.created_at).toBe(before[0]?.created_at);
  });

  it('leaves an already-current database untouched', async () => {
    const { db } = createDb({ url: ':memory:' });
    await runMigrations(db, migrationsFolder);
    const first = await db.all<{ hash: string }>(sql.raw('SELECT hash FROM `__drizzle_migrations`'));

    // Second run has nothing pending — no recovery, no duplicate journal rows.
    await expect(runMigrations(db, migrationsFolder)).resolves.toBe(migrationsFolder);
    const second = await db.all<{ hash: string }>(sql.raw('SELECT hash FROM `__drizzle_migrations`'));
    expect(second).toHaveLength(first.length);
  });

  it('still fails the upgrade on an error that is not an existing object', async () => {
    const { db } = createDb({ url: ':memory:' });
    // A migrations folder with a journal but no SQL files makes drizzle throw
    // a genuine read error, which must not be swallowed as "already applied".
    await expect(runMigrations(db, fileURLToPath(new URL('.', import.meta.url)))).rejects.toThrow();
  });
});
