import { count } from 'drizzle-orm';
import { databases, deployments, services, users } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { ABOUT } from '../version.js';

/** Public system info — no auth required. */
export const aboutRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    let stats = { services: 0, databases: 0, deployments: 0, users: 0 };
    try {
      const [s, d, dep, u] = await Promise.all([
        app.db.select({ n: count() }).from(services),
        app.db.select({ n: count() }).from(databases),
        app.db.select({ n: count() }).from(deployments),
        app.db.select({ n: count() }).from(users),
      ]);
      stats = {
        services: s[0]?.n ?? 0,
        databases: d[0]?.n ?? 0,
        deployments: dep[0]?.n ?? 0,
        users: u[0]?.n ?? 0,
      };
    } catch {
      /* DB not ready */
    }

    return { ...ABOUT, stats };
  });
};
