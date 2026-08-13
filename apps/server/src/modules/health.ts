import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';

/** Liveness + readiness. `GET /health` also pings the database. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    let db: 'ok' | 'error' = 'ok';
    try {
      await app.db.run(sql`SELECT 1`);
    } catch {
      db = 'error';
    }
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      version: config.version,
      time: new Date().toISOString(),
    };
  });
};
