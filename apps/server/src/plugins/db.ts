import { createDb, runMigrations, sql, type DB } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { config } from '../config.js';

// Augment the Fastify instance so `fastify.db` is typed everywhere.
declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

/* v8 ignore start */
/**
 * Self-healing runtime schema validation: ensures critical newly added columns
 * exist even if an existing SQLite file had skipped a partial migration step.
 */
async function ensureEssentialColumns(db: DB) {
  const statements = [
    'ALTER TABLE `databases` ADD COLUMN `web_gui_enabled` integer DEFAULT 0 NOT NULL;',
    'ALTER TABLE `databases` ADD COLUMN `web_gui_port` integer;',
    'ALTER TABLE `databases` ADD COLUMN `extensions` text DEFAULT \'[]\' NOT NULL;',
    'ALTER TABLE `domains` ADD COLUMN `basic_auth` text;',
    'ALTER TABLE `domains` ADD COLUMN `ip_allowlist` text;',
    'ALTER TABLE `domains` ADD COLUMN `rate_limit_average` integer;',
    'ALTER TABLE `domains` ADD COLUMN `rate_limit_burst` integer;',
    'ALTER TABLE `services` ADD COLUMN `preview_deployments_enabled` integer DEFAULT 0 NOT NULL;',
    'ALTER TABLE `services` ADD COLUMN `preview_auto_destroy_on_close` integer DEFAULT 1 NOT NULL;',
    'ALTER TABLE `services` ADD COLUMN `preview_domain_pattern` text;',
    'ALTER TABLE `services` ADD COLUMN `preview_max_active` integer DEFAULT 5 NOT NULL;',
    'ALTER TABLE `services` ADD COLUMN `is_ephemeral_preview` integer DEFAULT 0 NOT NULL;',
    'ALTER TABLE `services` ADD COLUMN `pr_number` integer;',
    'ALTER TABLE `build_configs` ADD COLUMN `pre_deploy_cmd` text;',
    'ALTER TABLE `build_configs` ADD COLUMN `post_deploy_cmd` text;',
    'ALTER TABLE `build_configs` ADD COLUMN `pre_stop_cmd` text;',
  ];

  for (const stmt of statements) {
    try {
      await db.run(sql.raw(stmt));
    } catch {
      // Column already exists or table not created yet — safe to ignore
    }
  }
}
/* v8 ignore stop */

/** Attaches a Drizzle-backed database connection and applies pending migrations. */
export default fp(
  async (fastify) => {
    if (!fastify.db) {
      const { db } = createDb({ url: config.dbUrl });
      // Self-migrating startup: applies pending migrations via the RUNTIME
      // migrator (drizzle-kit is a devDependency, absent in production builds
      // and containers). Idempotent — a no-op when the schema is current.
      const folder = await runMigrations(db);
      fastify.log.info({ folder }, 'database migrations applied');

      // Run runtime self-healing column check
      await ensureEssentialColumns(db);

      fastify.decorate('db', db);
    }
  },
  { name: 'ninedeploy-db' },
);
