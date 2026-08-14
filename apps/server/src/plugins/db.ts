import { createDb, runMigrations, type DB } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { config } from '../config.js';

// Augment the Fastify instance so `fastify.db` is typed everywhere.
declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

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
      fastify.decorate('db', db);
    }
  },
  { name: 'ninedeploy-db' },
);
