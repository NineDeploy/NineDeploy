import { existsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { backups, databases } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { config } from '../config.js';
import { backupDatabase } from '../engine/database.js';

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
            await fastify.db.insert(backups).values({
              databaseId: d.id,
              scope: 'db',
              status: 'completed',
              path: file,
              sizeBytes: existsSync(file) ? statSync(file).size : 0,
            });
          } catch (err) {
            fastify.log.error({ err }, `scheduled backup failed for ${d.name}`);
          }
          // Prune to the latest KEEP_PER_DB for this database.
          const rows = await fastify.db.query.backups.findMany({
            where: eq(backups.databaseId, d.id),
            orderBy: desc(backups.createdAt),
          });
          for (const stale of rows.slice(KEEP_PER_DB)) {
            if (existsSync(stale.path)) unlinkSync(stale.path);
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
      if (timer) clearTimeout(timer);
    });
    // First run in 24h (manual backups cover immediate needs); then daily.
    timer = setTimeout(() => void tick(), DAY_MS);
    fastify.log.info('backup scheduler armed (daily)');
  },
  { name: 'ninedeploy-backups' },
);
