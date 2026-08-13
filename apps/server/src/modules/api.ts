import type { FastifyPluginAsync } from 'fastify';
import { register } from '@ninedeploy/schemas';
import { createFirstAdmin } from './auth.js';
import { authRoutes } from './auth.js';
import { attachmentRoutes, databasesRoutes } from './databases.js';
import { deploysRoutes } from './deploys.js';
import { domainsRoutes } from './domains.js';
import { envRoutes } from './env.js';
import { hookReceiveRoutes, webhookMgmtRoutes } from './hooks.js';
import { metricRoutes, statsRoutes } from './stats.js';
import { servicesRoutes } from './services.js';

/** All versioned API routes, mounted under /v1. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  // Bootstrap: create the first admin user. Only succeeds when no users exist.
  app.post('/setup', async (req) => createFirstAdmin(app.db, register.parse(req.body)));

  // Public webhook receiver (auto-deploy on verified push).
  await app.register(hookReceiveRoutes, { prefix: '/hooks' });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(databasesRoutes, { prefix: '/databases' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(servicesRoutes, { prefix: '/services' });
  await app.register(deploysRoutes, { prefix: '/services' });
  await app.register(domainsRoutes, { prefix: '/services' });
  await app.register(webhookMgmtRoutes, { prefix: '/services' });
  await app.register(attachmentRoutes, { prefix: '/services' });
  await app.register(envRoutes, { prefix: '/services' });
  await app.register(metricRoutes, { prefix: '/services' });
};
