import { createReadStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { audit } from "../lib/audit.js";
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { backups, databases } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { backupDatabase, databaseSize, restoreDatabase } from '../engine/database.js';
import { badRequest, notFound } from '../lib/errors.js';

const num = (v: string) => Number(v);

function serialize(b: typeof backups.$inferSelect) {
  return {
    id: b.id,
    databaseId: b.databaseId,
    status: b.status,
    sizeBytes: b.sizeBytes,
    createdAt: b.createdAt.toISOString(),
  };
}

async function getDb(app: Parameters<FastifyPluginAsync>[0], id: number) {
  const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
  if (!d) throw notFound('Database not found');
  return d;
}

/** Per-database storage + backup actions. Mounted under /databases. */
export const databaseBackupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/storage', async (req) => {
    const d = await getDb(app, num((req.params as { id: string }).id));
    return { sizeBytes: await databaseSize(d) };
  });

  app.get('/:id/backups', async (req) => {
    const id = num((req.params as { id: string }).id);
    const rows = await app.db.query.backups.findMany({ where: eq(backups.databaseId, id), orderBy: desc(backups.createdAt) });
    return rows.map(serialize);
  });

  app.post('/:id/backups', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await getDb(app, id);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(config.paths.backupsDir, `${d.slug}-${ts}.dump`);
    const log = (line: string) => app.log.info({ component: 'backup' }, line);

    const [row] = await app.db.insert(backups).values({ databaseId: id, scope: 'db', status: 'running', path: file }).returning();
    try {
      log(`Backing up ${d.name} → ${path.basename(file)}`);
      await backupDatabase(d, file, log);
      const sizeBytes = existsSync(file) ? statSync(file).size : 0;
      await app.db.update(backups).set({ status: 'completed', sizeBytes }).where(eq(backups.id, row!.id));
    } catch (err) {
      await app.db.update(backups).set({ status: 'failed' }).where(eq(backups.id, row!.id));
      throw badRequest(`Backup failed: ${err instanceof Error ? err.message : err}`);
    }
    const updated = await app.db.query.backups.findFirst({ where: eq(backups.id, row!.id) });
    void audit(app.db, req.user!.id, 'backup.create', d.name);
    return serialize(updated!);
  });

  app.post('/:id/backups/:bid/restore', async (req) => {
    const id = num((req.params as { id: string }).id);
    const bid = num((req.params as { bid: string }).bid);
    const d = await getDb(app, id);
    const b = await app.db.query.backups.findFirst({ where: eq(backups.id, bid) });
    if (!b || !existsSync(b.path)) throw notFound('Backup not found');
    const log = (line: string) => app.log.info({ component: 'backup' }, line);
    try {
      log(`Restoring ${d.name} from ${path.basename(b.path)}`);
      await restoreDatabase(d, b.path, log);
    } catch (err) {
      throw badRequest(`Restore failed: ${err instanceof Error ? err.message : err}`);
    }
    void audit(app.db, req.user!.id, 'backup.restore', path.basename(b.path));
    return { ok: true };
  });
};

/** Global backup list + delete + download. Mounted under /backups. */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const rows = await app.db.query.backups.findMany({ orderBy: desc(backups.createdAt) });
    const dbs = await app.db.select().from(databases);
    const name = new Map(dbs.map((d) => [d.id, d.name]));
    return rows.map((b) => ({ ...serialize(b), databaseName: b.databaseId ? (name.get(b.databaseId) ?? null) : null }));
  });

  app.delete('/:bid', async (req) => {
    const bid = num((req.params as { bid: string }).bid);
    const b = await app.db.query.backups.findFirst({ where: eq(backups.id, bid) });
    if (b && existsSync(b.path)) unlinkSync(b.path);
    await app.db.delete(backups).where(eq(backups.id, bid));
    void audit(app.db, req.user!.id, 'backup.delete', `#${bid}`);
    return { ok: true };
  });

  app.get('/:bid/download', async (req, reply) => {
    const bid = num((req.params as { bid: string }).bid);
    const b = await app.db.query.backups.findFirst({ where: eq(backups.id, bid) });
    if (!b || !existsSync(b.path)) throw notFound('Backup not found');
    reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename="${path.basename(b.path)}"`)
      .send(createReadStream(b.path));
  });
};
