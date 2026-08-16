import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';

const PAGE_SIZE = 50;

const listQuery = z.object({
  entity: z.string().optional(),
  action: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
  /** Cursor: return rows strictly older than this audit id. */
  before: z.coerce.number().int().positive().optional(),
});

/** Recent activity (audit log). Mounted under /activity. */
export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const q = listQuery.parse(req.query);
    const filters: SQL[] = [];
    if (q.entity) filters.push(eq(auditLog.entity, q.entity));
    if (q.action) filters.push(eq(auditLog.action, q.action));
    if (q.userId) filters.push(eq(auditLog.userId, q.userId));
    if (q.before) filters.push(lt(auditLog.id, q.before));
    const rows = await app.db.query.auditLog.findMany({
      where: filters.length ? and(...filters) : undefined,
      orderBy: desc(auditLog.id),
      limit: PAGE_SIZE,
    });
    return {
      entries: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        action: r.action,
        entity: r.entity,
        meta: r.meta ?? null,
        ts: r.ts.toISOString(),
      })),
      nextCursor: rows.length === PAGE_SIZE ? rows[PAGE_SIZE - 1]!.id : null,
    };
  });
};
