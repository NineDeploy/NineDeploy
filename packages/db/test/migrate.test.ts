import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/client.js';
import { pickMigrationsFolder, resolveMigrationsFolder, runMigrations } from '../src/migrate.js';

// The repo's real migrations folder, resolved from THIS test file's location
// (works regardless of the cwd vitest was started from).
const REPO_MIGRATIONS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/migrations');

describe('pickMigrationsFolder', () => {
  it('returns the first candidate that carries the journal', () => {
    expect(pickMigrationsFolder([undefined, REPO_MIGRATIONS])).toBe(REPO_MIGRATIONS);
  });

  it('skips candidates without a journal', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'nd-pick-'));
    try {
      expect(pickMigrationsFolder([empty, REPO_MIGRATIONS])).toBe(REPO_MIGRATIONS);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('returns null when no candidate qualifies', () => {
    expect(pickMigrationsFolder([undefined, '/does/not/exist'])).toBeNull();
  });
});

describe('resolveMigrationsFolder', () => {
  it('finds the repo migrations folder', () => {
    const folder = resolveMigrationsFolder();
    expect(folder).toBeTruthy();
    expect(existsSync(path.join(folder!, 'meta', '_journal.json'))).toBe(true);
  });
});

describe('runMigrations', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-runmig-'));

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('applies the real migrations to a fresh SQLite file and is idempotent', async () => {
    const { db } = createDb({ url: `file:${path.join(tmp, 'migrate.db')}` });

    const folder = await runMigrations(db);
    expect(folder).toBeTruthy();

    // The migrated schema is real: core tables exist and accept writes.
    await db.run(sql`INSERT INTO users (email, password_hash) VALUES ('a@b.c', 'x')`);
    const rows = await db.run(sql`SELECT COUNT(*) AS n FROM users`);
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(1);
    // A second run is a no-op (idempotent startup path).
    await expect(runMigrations(db)).resolves.toBe(folder);
  });

  it('throws a clear error when no migrations folder can be resolved', async () => {
    const { db } = createDb({ url: ':memory:' });
    // An empty override path exercises the not-found branch.
    await expect(runMigrations(db, '')).rejects.toThrow('NINEDEPLOY_MIGRATIONS_DIR');
  });
});
