import { createDb, type DB } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { config } from '../config.js';

// Augment the Fastify instance so `fastify.db` is typed everywhere.
declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

/** Attaches a Drizzle-backed database connection to the Fastify instance. */
export default fp(
  async (fastify) => {
    if (!fastify.db) {
      const { db } = createDb({ url: config.dbUrl });
      fastify.decorate('db', db);
    }
  },
  { name: 'ninedeploy-db' },
);
