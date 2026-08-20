import { existsSync, statSync, unlinkSync } from 'node:fs';
import { audit } from '../lib/audit.js';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { backups, databases } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { backupDatabase, createBackupReadStream, databaseSize, restoreDatabase } from '../engine/database.js';
import { deleteRemoteBackup, fetchRemoteBackup, uploadBackup } from '../lib/backupRemote.js';
import { type AuthedUser, loadDatabaseForUser, visibleDatabaseIds } from '../lib/resourceAccess.js';
import { badRequest, notFound, parseId as num } from '../lib/errors.js';

function serialize(b: typeof backups.$inferSelect) {
  return {
    id: b.id,
    databaseId: b.databaseId,
    status: b.status,
    sizeBytes: b.sizeBytes,
    createdAt: b.createdAt.toISOString(),
  };
}

/**
 * Resolve a database the caller may see. Delegates to the shared access
 * choke-point rather than doing a bare id lookup: these routes expose the
 * existence, name, size and backup cadence of a tenant's database, so they
 * need the same decision every route in `modules/databases.ts` makes.
 */
async function getDb(app: Parameters<FastifyPluginAsync>[0], id: number, user: AuthedUser) {
  return loadDatabaseForUser(app.db, id, user);
}

/** Per-database storage + backup actions. Mounted under /databases. */
export const databaseBackupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/storage', async (req) => {
    const d = await getDb(app, num((req.params as { id: string }).id), req.user!);
    return { sizeBytes: await databaseSize(d) };
  });

  app.get('/:id/backups', async (req) => {
    const id = num((req.params as { id: string }).id);
    await getDb(app, id, req.user!);
    const rows = await app.db.query.backups.findMany({ where: eq(backups.databaseId, id), orderBy: desc(backups.createdAt) });
    return rows.map(serialize);
  });

  // Creating a backup means acquiring a full plaintext dump of the database —
  // admin-only, consistent with exec/volume-file access.
  app.post('/:id/backups', { preHandler: [app.requireAdmin] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await getDb(app, id, req.user!);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(config.paths.backupsDir, `${d.slug}-${ts}.dump`);
    const log = (line: string) => app.log.info({ component: 'backup' }, line);

    const [row] = await app.db.insert(backups).values({ databaseId: id, scope: 'db', status: 'running', path: file }).returning();
    try {
      log(`Backing up ${d.name} → ${path.basename(file)}`);
      await backupDatabase(d, file, log);
      const sizeBytes = existsSync(file) ? statSync(file).size : 0;
      await app.db.update(backups).set({ status: 'completed', sizeBytes }).where(eq(backups.id, row!.id));
      // Remote copy (best-effort — never fails the local backup).
      await uploadBackup(app.db, row!.id, file, log);
    } catch (err) {
      await app.db.update(backups).set({ status: 'failed' }).where(eq(backups.id, row!.id));
      throw badRequest(`Backup failed: ${err instanceof Error ? err.message : err}`);
    }
    const updated = await app.db.query.backups.findFirst({ where: eq(backups.id, row!.id) });
    void audit(app.db, req.user!.id, 'backup.create', d.name);
    return serialize(updated!);
  });

  app.post('/:id/backups/:bid/restore', { preHandler: [app.requireAdmin] }, async (req) => {
    const id = num((req.params as { id: string }).id);
    const bid = num((req.params as { bid: string }).bid);
    const d = await getDb(app, id, req.user!);
    const b = await app.db.query.backups.findFirst({ where: eq(backups.id, bid) });
    // Ownership: without this check a backup of database A could be restored
    // into database B (cross-database data corruption).
    if (!b || b.databaseId !== d.id) throw notFound('Backup not found');
    const log = (line: string) => app.log.info({ component: 'backup' }, line);
    // Remote-only backups are fetched to a local temp path first.
    let restorePath = b.path;
    const isRemoteTemp = !existsSync(b.path);
    if (isRemoteTemp) {
      if (!b.remoteKey) throw notFound('Backup not found');
      restorePath = path.join(config.paths.backupsDir, `${path.basename(b.path)}.remote`);
      log(`Fetching remote object ${b.remoteKey}`);
      await fetchRemoteBackup(app.db, b.remoteKey, restorePath);
    }
    try {
      log(`Restoring ${d.name} from ${path.basename(restorePath)}`);
      await restoreDatabase(d, restorePath, log);
    } catch (err) {
      throw badRequest(`Restore failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      // The fetched temp copy is not tracked in the DB — always remove it.
      if (isRemoteTemp) {
        try {
          unlinkSync(restorePath);
        } catch {
          /* best-effort */
        }
      }
    }
    void audit(app.db, req.user!.id, 'backup.restore', path.basename(restorePath));
    return { ok: true };
  });
};

/** Global backup list + delete + download. Mounted under /backups. */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const rows = await app.db.query.backups.findMany({ orderBy: desc(backups.createdAt) });
    const dbs = await app.db.select().from(databases);
    const name = new Map(dbs.map((d) => [d.id, d.name]));
    // Members see only backups of databases they may access; `null` means
    // unrestricted (admin). The instance-wide list would otherwise disclose
    // every tenant's database names, backup sizes and schedule cadence.
    const visible = await visibleDatabaseIds(app.db, req.user!);
    const scoped = visible === null ? rows : rows.filter((b) => b.databaseId != null && visible.includes(b.databaseId));
    return scoped.map((b) => ({ ...serialize(b), databaseName: b.databaseId ? (name.get(b.databaseId) ?? null) : null }));
  });

  app.delete('/:bid', { preHandler: [app.requireAdmin] }, async (req) => {
    const bid = num((req.params as { bid: string }).bid);
    const b = await app.db.query.backups.findFirst({ where: eq(backups.id, bid) });
    if (b && existsSync(b.path)) unlinkSync(b.path);
    if (b) await deleteRemoteBackup(app.db, b.remoteKey);
    await app.db.delete(backups).where(eq(backups.id, bid));
    void audit(app.db, req.user!.id, 'backup.delete', `#${bid}`);
    return { ok: true };
  });

  // Downloading returns the decrypted plaintext dump — admin-only.
  app.get('/:bid/download', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const bid = num((req.params as { bid: string }).bid);
    const b = await app.db.query.backups.findFirst({ where: eq(backups.id, bid) });
    if (!b || !existsSync(b.path)) throw notFound('Backup not found');
    // Backups are encrypted at rest — hand the user the PLAINTEXT dump.
    return reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename="${path.basename(b.path)}"`)
      .send(await createBackupReadStream(b.path));
  });
};
