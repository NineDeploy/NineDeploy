import { desc } from 'drizzle-orm';
import { auditLog } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';

/** Recent activity (audit log). Mounted under /activity. */
export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const rows = await app.db.query.auditLog.findMany({ orderBy: desc(auditLog.ts), limit: 50 });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      entity: r.entity,
      ts: r.ts.toISOString(),
    }));
  });
};
