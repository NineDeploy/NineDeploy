import type { FastifyPluginAsync } from 'fastify';
import { register } from '@ninedeploy/schemas';
import { createFirstAdmin } from './auth.js';
import { authRoutes } from './auth.js';
import { aboutRoutes } from './about.js';
import { activityRoutes } from './activity.js';
import { dashboardRoutes } from './dashboard.js';
import { attachmentRoutes, databasesRoutes } from './databases.js';
import { backupRoutes, databaseBackupRoutes } from './backups.js';
import { deploysRoutes } from './deploys.js';
import { domainIndexRoutes } from './domainIndex.js';
import { domainsRoutes } from './domains.js';
import { envRoutes } from './env.js';
import { hookReceiveRoutes, webhookMgmtRoutes } from './hooks.js';
import { notificationRoutes } from './notifications.js';
import { metricRoutes, statsRoutes } from './stats.js';
import { servicesRoutes } from './services.js';
import { serviceMigrationRoutes } from './serviceMigration.js';
import { sourcesRoutes } from './sources.js';
import { systemRoutes } from './resources.js';
import { templateRoutes } from './templates.js';
import { topologyRoutes } from './topology.js';
import { tunnelRoutes } from './tunnels.js';
import { userRoutes } from './users.js';
import { volumeRoutes } from './volumes.js';

/** All versioned API routes, mounted under /v1. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  // Bootstrap: create the first admin user. Only succeeds when no users exist.
  // Rate-limited tighter than the global default to deter setup-race attacks.
  app.post('/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) =>
    createFirstAdmin(app.db, register.parse(req.body)),
  );

  // Public webhook receiver (auto-deploy on verified push).
  await app.register(hookReceiveRoutes, { prefix: '/hooks' });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(activityRoutes, { prefix: '/activity' });
  await app.register(aboutRoutes, { prefix: '/about' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(databasesRoutes, { prefix: '/databases' });
  await app.register(databaseBackupRoutes, { prefix: '/databases' });
  await app.register(backupRoutes, { prefix: '/backups' });
  await app.register(domainIndexRoutes, { prefix: '/domains' });
  await app.register(volumeRoutes, { prefix: '/volumes' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(dashboardRoutes, { prefix: '/dashboard' });
  await app.register(systemRoutes, { prefix: '/system' });
  await app.register(sourcesRoutes, { prefix: '/sources' });
  await app.register(topologyRoutes, { prefix: '/topology' });
  await app.register(tunnelRoutes, { prefix: '/tunnels' });
  await app.register(templateRoutes, { prefix: '/templates' });
  await app.register(servicesRoutes, { prefix: '/services' });
  await app.register(deploysRoutes, { prefix: '/services' });
  await app.register(domainsRoutes, { prefix: '/services' });
  await app.register(webhookMgmtRoutes, { prefix: '/services' });
  await app.register(attachmentRoutes, { prefix: '/services' });
  await app.register(envRoutes, { prefix: '/services' });
  await app.register(metricRoutes, { prefix: '/services' });
  await app.register(serviceMigrationRoutes, { prefix: '/services' });
};
