import { existsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { backups, databases } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { config } from '../config.js';
import { backupDatabase } from '../engine/database.js';
import { uploadBackup } from '../lib/backupRemote.js';

const KEEP_PER_DB = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Backs up every running database once a day, keeping the latest KEEP_PER_DB per database. */
export default fp(
  async (fastify) => {
    let running = true;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      try {
        const dbs = (await fastify.db.select().from(databases)).filter((d) => d.status === 'running');
        for (const d of dbs) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const file = path.join(config.paths.backupsDir, `${d.slug}-${ts}.dump`);
          const log = (line: string) => fastify.log.info({ component: 'backup' }, line);
          try {
            await backupDatabase(d, file, log);
            const [row] = await fastify.db
              .insert(backups)
              .values({
                databaseId: d.id,
                scope: 'scheduled',
                status: 'completed',
                path: file,
                sizeBytes: existsSync(file) ? statSync(file).size : 0,
              })
              .returning({ id: backups.id });
            // Remote copy (best-effort, same as manual backups).
            if (row) await uploadBackup(fastify.db, row.id, file, log);
          } catch (err) {
            fastify.log.error({ err }, `scheduled backup failed for ${d.name}`);
          }
          // Prune the latest KEEP_PER_DB SCHEDULED backups for this database.
          // Manual (user-initiated) backups are never touched by the scheduler
          // and must be deleted explicitly from the UI.
          const rows = await fastify.db.query.backups.findMany({
            where: eq(backups.databaseId, d.id),
            orderBy: desc(backups.createdAt),
          });
          const scheduled = rows.filter((r) => r.scope === 'scheduled');
          for (const stale of scheduled.slice(KEEP_PER_DB)) {
            try {
              if (existsSync(stale.path)) unlinkSync(stale.path);
            } catch {
              /* file may be unreadable — still drop the row */
            }
            await fastify.db.delete(backups).where(eq(backups.id, stale.id));
          }
        }
      } catch (err) {
        fastify.log.error({ err }, 'backup scheduler tick failed');
      } finally {
        if (running) timer = setTimeout(() => void tick(), DAY_MS);
      }
    };

    fastify.addHook('onClose', async () => {
      running = false;
      clearTimeout(timer);
    });
    // First run in 24h (manual backups cover immediate needs); then daily.
    timer = setTimeout(() => void tick(), DAY_MS);
    fastify.log.info('backup scheduler armed (daily)');
  },
  { name: 'ninedeploy-backups' },
);
