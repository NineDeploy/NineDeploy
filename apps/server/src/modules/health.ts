import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { VERSION } from '../version.js';

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
      version: VERSION,
      time: new Date().toISOString(),
    };
  });
};
