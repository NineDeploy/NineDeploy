import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';

const listQuery = z.object({ entity: z.string().optional() });

/** Recent activity (audit log). Mounted under /activity. */
export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const q = listQuery.parse(req.query);
    const rows = await app.db.query.auditLog.findMany({
      where: q.entity ? eq(auditLog.entity, q.entity) : undefined,
      orderBy: desc(auditLog.ts),
      limit: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      entity: r.entity,
      ts: r.ts.toISOString(),
    }));
  });
};
