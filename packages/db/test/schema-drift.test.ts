import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { eq, is } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/index.js';

const migrationsFolder = fileURLToPath(new URL('../src/migrations', import.meta.url));

/**
 * The migrations and the Drizzle schema must describe the same database.
 *
 * The server self-migrates at startup and every query is typed against
 * `schema.ts`, so a column added to the schema without a migration does not
 * fail to compile and does not fail any unit test — it fails at runtime, on the
 * first request that touches it, in production. Nothing checked the two
 * against each other: `schema.test.ts` migrates an in-memory database and then
 * round-trips four tables out of forty.
 *
 * This applies the whole migration chain to a fresh database and compares every
 * declared table and column against `PRAGMA table_info`, in both directions.
 */
describe('schema ↔ migrations', () => {
  /** Every Drizzle table object exported from the schema. */
  const tables = Object.values(schema).filter((v): v is SQLiteTable => is(v, SQLiteTable));

  it('exports a plausible number of tables (guards the filter itself)', () => {
    // A broken filter would make every assertion below vacuous.
    expect(tables.length).toBeGreaterThan(30);
  });

  it('creates every table and column the schema declares, and nothing it does not', async () => {
    const { db, client } = schema.createDb({ url: ':memory:' });
    await migrate(db, { migrationsFolder });

    const missingTables: string[] = [];
    const missingColumns: string[] = [];
    const extraColumns: string[] = [];

    for (const table of tables) {
      const cfg = getTableConfig(table);
      const info = await client.execute(`PRAGMA table_info("${cfg.name}")`);
      const actual = new Set(info.rows.map((r) => String(r['name'])));
      if (actual.size === 0) {
        missingTables.push(cfg.name);
        continue;
      }
      const declared = new Set(cfg.columns.map((c) => c.name));
      for (const col of declared) if (!actual.has(col)) missingColumns.push(`${cfg.name}.${col}`);
      // The other direction matters too: a column the migrations still create
      // but the schema has dropped is a NOT NULL insert failure waiting to
      // happen, and dead weight in every backup.
      for (const col of actual) if (!declared.has(col)) extraColumns.push(`${cfg.name}.${col}`);
    }

    expect({ missingTables, missingColumns, extraColumns }).toEqual({
      missingTables: [],
      missingColumns: [],
      extraColumns: [],
    });
  });

  it('round-trips a log drain (the table the drift check found missing)', async () => {
    // `log_drains` was in `schema.ts` and in drizzle-kit's snapshot but in no
    // migration, so a fresh install had no table and Settings → Log Drains
    // failed with "no such table". Prove the migration produces a usable one:
    // defaults, the encrypted column, and the cascade to `services`.
    const { db } = schema.createDb({ url: ':memory:' });
    await migrate(db, { migrationsFolder });

    const [svc] = await db.insert(schema.services).values({ name: 'api', slug: 'api' }).returning();
    const [drain] = await db
      .insert(schema.logDrains)
      .values({ name: 'datadog', url: 'https://http-intake.logs.datadoghq.com', serviceId: svc!.id, apiKeyEncrypted: 'v0:iv:tag:ct' })
      .returning();
    expect(drain).toMatchObject({ name: 'datadog', type: 'http', format: 'json', enabled: true });

    await db.delete(schema.services).where(eq(schema.services.id, svc!.id));
    expect(await db.select().from(schema.logDrains).all()).toHaveLength(0);
  });
});
