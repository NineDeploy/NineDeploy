import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/index.js';

const migrationsFolder = fileURLToPath(new URL('../src/migrations', import.meta.url));

describe('schema', () => {
  const tables = [
    'users',
    'apiTokens',
    'projects',
    'services',
    'buildConfigs',
    'deployments',
    'envVars',
    'sources',
    'domains',
    'webhooks',
    'backups',
    'metrics',
    'auditLog',
    'settings',
    'databases',
    'databaseAttachments',
    'tunnels',
    'notificationChannels',
    'notificationLog',
  ] as const;

  it('exposes every expected table', () => {
    for (const table of tables) {
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the whole point of this test is verifying each export exists by name.
      expect(schema[table], `missing table ${table}`).toBeDefined();
    }
  });

  it('exposes the expected enum arrays', () => {
    for (const name of [
      'userRole',
      'serviceType',
      'serviceStatus',
      'buildPack',
      'deploymentStatus',
      'deploymentTrigger',
      'domainStatus',
      'sourceType',
      'backupScope',
      'backupStatus',
      'dbEngine',
      'dbStatus',
      'tunnelStatus',
      'channelType',
      'alertMetric',
      'alertOperator',
      'alertStateStatus',
    ] as const) {
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the whole point of this test is verifying each enum export exists by name.
      expect(schema[name], `missing enum ${name}`).toBeDefined();
    }
  });

  it('exposes the expected relations', () => {
    for (const name of [
      'usersRelations',
      'apiTokensRelations',
      'projectsRelations',
      'servicesRelations',
      'buildConfigsRelations',
      'deploymentsRelations',
      'envVarsRelations',
      'domainsRelations',
      'webhooksRelations',
      'metricsRelations',
      'databasesRelations',
      'databaseAttachmentsRelations',
      'notificationLogRelations',
      'alertRulesRelations',
      'alertStateRelations',
      'passwordResetTokensRelations',
    ] as const) {
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the whole point of this test is resolving each relation export by name.
      expect(schema[name], `missing relation ${name}`).toBeDefined();
    }
  });

  it('resolves every foreign key reference in the schema', () => {
    const tables = [
      'users',
      'apiTokens',
      'projects',
      'services',
      'buildConfigs',
      'deployments',
      'envVars',
      'sources',
      'domains',
      'webhooks',
      'backups',
      'metrics',
      'auditLog',
      'settings',
      'databases',
      'databaseAttachments',
      'tunnels',
      'notificationChannels',
      'notificationLog',
      'alertRules',
      'alertState',
      'passwordResetTokens',
      'jobRuns',
      'scheduledJobs',
    ] as const;
    for (const name of tables) {
      const table = (schema as unknown as Record<string, unknown>)[name];
      if (!table || typeof table !== 'object') continue;
      const config = getTableConfig(table as never);
      for (const fk of config.foreignKeys) {
        // getName() resolves the lazy `references(() => ...)` callbacks.
        expect(fk.getName()).toContain('_fk');
      }
    }
  });

  it('runs a real insert + select + update roundtrip through the in-memory db', async () => {
    const { db } = schema.createDb({ url: ':memory:' });
    await migrate(db, { migrationsFolder });

    const inserted = await db
      .insert(schema.users)
      .values({ email: 'ada@example.com', passwordHash: 'hash', name: 'Ada' })
      .returning();
    expect(inserted[0]?.email).toBe('ada@example.com');

    const rows = await db.select().from(schema.users).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Ada');

    await db.update(schema.users).set({ name: 'Ada Lovelace' }).where(eq(schema.users.email, 'ada@example.com')).run();
    const updated = await db.select().from(schema.users).all();
    expect(updated[0]?.name).toBe('Ada Lovelace');
  });

  it('allows two deployments of the same service within the same second (non-unique index)', async () => {
    const { db } = schema.createDb({ url: ':memory:' });
    await migrate(db, { migrationsFolder });

    const [svc] = await db.insert(schema.services).values({ name: 'web', slug: 'web' }).returning();
    expect(svc?.id).toBeDefined();

    // `created_at` is stored as unix epoch SECONDS (integer timestamp mode):
    // two instants 500 ms apart within the same second map to the SAME stored
    // value, which the old UNIQUE (service_id, created_at) index rejected with
    // a constraint violation on the second insert (deploy trigger 500s).
    const t0 = new Date(1700000000000);
    const t1 = new Date(1700000000500);
    await db.insert(schema.deployments).values({ serviceId: svc!.id, createdAt: t0 });
    await db.insert(schema.deployments).values({ serviceId: svc!.id, createdAt: t1 });

    const rows = await db.select().from(schema.deployments).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.serviceId === svc!.id)).toBe(true);
  });
});
