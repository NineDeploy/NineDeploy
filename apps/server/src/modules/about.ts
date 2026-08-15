import { count } from 'drizzle-orm';
import { databases, deployments, services, users } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { ABOUT } from '../version.js';

/**
 * System info. Version/license/repo are public (useful for support and
 * update-check banners); instance counts are only included for authenticated
 * requests — an unauthenticated caller must not learn how many users or
 * workloads an instance hosts.
 */
export const aboutRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    // Optional auth: no Authorization header → public subset, never a 401
    // (the login page links here and the About UI is authed anyway).
    let authenticated = false;
    if (req.headers.authorization) {
      try {
        await app.authenticate(req, reply);
        authenticated = true;
      } catch {
        /* invalid token → still serves the public subset */
      }
    }

    if (!authenticated) {
      return { ...ABOUT };
    }

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
