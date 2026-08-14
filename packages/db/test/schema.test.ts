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
    ] as const) {
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
});
