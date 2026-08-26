/**
 * Tests for the manifest → service orchestrator. Uses an in-memory SQLite
 * with the real Drizzle schema so the SQL semantics (unique indexes,
 * cascades, default values) are exercised end-to-end — no mocks.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  alertRules,
  createDb,
  databases,
  databaseAttachments,
  domains,
  services,
  type DB,
} from '@ninedeploy/db';
import { applyManifestToService } from '../../src/lib/applyManifestToService.js';
import type { NinedeployManifest } from '@ninedeploy/schemas';

const migrationsFolder = fileURLToPath(
  new URL('../../../../packages/db/src/migrations', import.meta.url),
);

const m = (over: Partial<NinedeployManifest>): NinedeployManifest => ({
  version: '1',
  ...over,
});

let db: DB;
let serviceId: number;

beforeAll(async () => {
  db = createDb({ url: ':memory:' }).db;
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Wipe child tables before parents because of FK cascades (parents reference
  // parents). Order matters: leaves first, then services, then databases.
  await db.delete(alertRules);
  await db.delete(domains);
  await db.delete(databaseAttachments);
  await db.delete(services);
  await db.delete(databases);

  const [svc] = await db
    .insert(services)
    .values({
      name: 'web',
      slug: 'web',
      type: 'docker',
      port: 3000,
      healthPath: '/',
    })
    .returning();
  serviceId = svc!.id;
});

afterEach(async () => {
  // Cleanup is handled in beforeEach.
});

describe('applyManifestToService — routes', () => {
  it('inserts a domain in pending state for each declared route', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({
        routes: [
          {
            host: 'app.example.com',
            path: '/',
            ssl: true,
            headers: { 'X-Frame-Options': 'DENY' },
            ipAllowlist: ['1.2.3.4/32', '10.0.0.0/8'],
            rateLimit: { average: 50, burst: 100 },
          },
        ],
      }),
    );
    expect(result.routesUpserted).toBe(1);

    const rows = await db.query.domains.findMany({ where: eq(domains.serviceId, serviceId) });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.hostname).toBe('app.example.com');
    expect(r.path).toBe('/');
    expect(r.ssl).toBe(true);
    expect(r.status).toBe('pending');
    expect(r.headers).toBe(JSON.stringify([{ name: 'X-Frame-Options', value: 'DENY' }]));
    expect(r.ipAllowlist).toBe('1.2.3.4/32, 10.0.0.0/8');
    expect(r.rateLimitAverage).toBe(50);
    expect(r.rateLimitBurst).toBe(100);
  });

  it('normalises the hostname to lowercase (DNS is case-insensitive)', async () => {
    await applyManifestToService(
      db,
      serviceId,
      m({ routes: [{ host: 'APP.Example.COM', path: '/' }] }),
    );
    const [r] = await db.select().from(domains).where(eq(domains.serviceId, serviceId));
    expect(r!.hostname).toBe('app.example.com');
  });

  it('updates an existing domain in place when the (host, path) matches', async () => {
    await db.insert(domains).values({
      serviceId,
      hostname: 'app.example.com',
      path: '/',
      ssl: false,
      status: 'active',
    });

    await applyManifestToService(
      db,
      serviceId,
      m({ routes: [{ host: 'app.example.com', path: '/', ssl: true }] }),
    );

    const rows = await db.select().from(domains).where(eq(domains.serviceId, serviceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ssl).toBe(true);
    // Status is the panel's concern — manifest never demotes an active host.
    expect(rows[0]!.status).toBe('active');
  });

  it('inserts two distinct domains for two different (host, path) pairs', async () => {
    await applyManifestToService(
      db,
      serviceId,
      m({
        routes: [
          { host: 'a.example.com', path: '/' },
          { host: 'a.example.com', path: '/api' },
        ],
      }),
    );
    const rows = await db.select().from(domains).where(eq(domains.serviceId, serviceId));
    expect(rows).toHaveLength(2);
  });

  it('leaves existing domains alone when the manifest declares no routes', async () => {
    await db.insert(domains).values({
      serviceId,
      hostname: 'existing.example.com',
      path: '/',
      ssl: true,
      status: 'active',
    });
    const result = await applyManifestToService(db, serviceId, m({}));
    expect(result.routesUpserted).toBe(0);
    const rows = await db.select().from(domains).where(eq(domains.serviceId, serviceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hostname).toBe('existing.example.com');
  });
});

describe('applyManifestToService — database', () => {
  beforeEach(async () => {
    // The drizzle schema declares `ownerUserId` on the `databases` table but
    // the latest migration does not yet add the column on `databases` (only
    // on `services`). Until the schema/migration drift is fixed, we insert
    // via raw SQL so the test does not depend on the missing column.
    const { sql } = await import('drizzle-orm');
    await db.run(sql`INSERT INTO databases (name, slug, engine, status, password_encrypted, volume_name) VALUES ('app-db', 'app-db', 'postgres', 'ready', 'fake-ciphertext', 'nd-db-app-db')`);
  });

  it('attaches a managed database by slug', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({ database: { ref: 'app-db', env: 'DATABASE_URL' } }),
    );
    expect(result.databaseAttached).toBe(true);
    const attaches = await db
      .select()
      .from(databaseAttachments)
      .where(eq(databaseAttachments.serviceId, serviceId));
    expect(attaches).toHaveLength(1);
    expect(attaches[0]!.envAlias).toBe('DATABASE_URL');
  });

  it('is idempotent — re-running the manifest does not create a second attachment', async () => {
    await applyManifestToService(db, serviceId, m({ database: { ref: 'app-db', env: 'A' } }));
    await applyManifestToService(db, serviceId, m({ database: { ref: 'app-db', env: 'B' } }));
    const attaches = await db
      .select()
      .from(databaseAttachments)
      .where(eq(databaseAttachments.serviceId, serviceId));
    expect(attaches).toHaveLength(1);
    // The original env alias is preserved — manifest cannot flip an existing alias.
    expect(attaches[0]!.envAlias).toBe('A');
  });

  it('emits a warning and a notFound marker when the slug does not resolve', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({ database: { ref: 'ghost-db', env: 'DB_URL' } }),
    );
    expect(result.databaseAttached).toBe(false);
    expect(result.databaseNotFound).toBe('ghost-db');
    expect(result.warnings.join('\n')).toMatch(/ghost-db/);
  });

  it('does nothing when the manifest has no database section', async () => {
    const result = await applyManifestToService(db, serviceId, m({}));
    expect(result.databaseAttached).toBe(false);
    expect(result.databaseNotFound).toBeNull();
  });
});

describe('applyManifestToService — alerts', () => {
  it('inserts an alert rule per declared alert', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({
        alerts: [
          { when: 'deployFailed', channel: 'oncall' },
          { when: 'highMemory', channel: 'oncall', thresholdPct: 85 },
        ],
      }),
    );
    expect(result.alertsUpserted).toBe(2);
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.serviceId, serviceId));
    expect(rules).toHaveLength(2);
  });

  it('maps highMemory to a memory-metric rule with the manifest threshold', async () => {
    await applyManifestToService(
      db,
      serviceId,
      m({ alerts: [{ when: 'highMemory', channel: 'oncall', thresholdPct: 75 }] }),
    );
    const [rule] = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.serviceId, serviceId));
    expect(rule!.metric).toBe('memory');
    expect(rule!.operator).toBe('>');
    expect(rule!.threshold).toBe(75);
  });

  it('encodes the channel in the rule name so two alerts with the same when can coexist', async () => {
    await applyManifestToService(
      db,
      serviceId,
      m({
        alerts: [
          { when: 'highMemory', channel: 'oncall', thresholdPct: 90 },
          { when: 'highMemory', channel: 'ops', thresholdPct: 70 },
        ],
      }),
    );
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.serviceId, serviceId));
    const names = rules.map((r) => r.name).sort();
    expect(names).toEqual([`svc-${serviceId}-highMemory-oncall`, `svc-${serviceId}-highMemory-ops`]);
  });

  it('updates an existing rule instead of duplicating it', async () => {
    await applyManifestToService(
      db,
      serviceId,
      m({ alerts: [{ when: 'highMemory', channel: 'oncall', thresholdPct: 50 }] }),
    );
    await applyManifestToService(
      db,
      serviceId,
      m({ alerts: [{ when: 'highMemory', channel: 'oncall', thresholdPct: 95 }] }),
    );
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.serviceId, serviceId));
    expect(rules).toHaveLength(1);
    expect(rules[0]!.threshold).toBe(95);
  });

  it('does nothing when the manifest declares no alerts', async () => {
    const result = await applyManifestToService(db, serviceId, m({}));
    expect(result.alertsUpserted).toBe(0);
  });
});

describe('applyManifestToService — deferred sections emit warnings', () => {
  it('emits a warning when volume.backups is declared', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({ volume: { mount: '/data', backups: { schedule: '0 3 * * *', retention: 7 } } }),
    );
    expect(result.warnings.join('\n')).toMatch(/volume\.backups/);
  });

  it('emits a warning listing the declared notification channels', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({ notifications: { onDeploy: ['ops'], onFailure: ['oncall'], onAlert: [] } }),
    );
    expect(result.warnings.join('\n')).toMatch(/notifications.*ops.*oncall/);
  });

  it('emits a warning when previews.enabled is true', async () => {
    const result = await applyManifestToService(
      db,
      serviceId,
      m({ previews: { enabled: true, pattern: 'pr-{n}.example.com' } }),
    );
    expect(result.warnings.join('\n')).toMatch(/previews/);
  });

  it('produces no warnings for a minimal manifest', async () => {
    const result = await applyManifestToService(db, serviceId, m({}));
    expect(result.warnings).toEqual([]);
  });
});
