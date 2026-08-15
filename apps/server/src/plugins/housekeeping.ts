import { lt } from 'drizzle-orm';
import { auditLog, notificationLog } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { run } from '../lib/exec.js';
import { pruneOldLogs } from '../engine/logs.js';
import { pruneResetTokens } from '../lib/passwordReset.js';

const swallow = () => {};
const INTERVAL_MS = 60 * 60 * 1000; // hourly
/** Deploy-log files older than this are deleted. */
const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Audit rows older than this are deleted. */
const AUDIT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
/** Notification-log rows older than this are deleted. */
const NOTIF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Remove dangling (untagged) Docker images — the orphaned layers left behind by
 * failed/interrupted builds. Tagged images (incl. `ninedeploy/<slug>:<sha>` used
 * for rollback) and images referenced by a running container are never dangling,
 * so this is safe and never evicts something in use.
 */
function pruneDanglingImages(): void {
  void run('docker', ['image', 'prune', '-f'], {}, swallow).catch(() => undefined);
}

/**
 * Periodic housekeeping: prunes deploy-log files, time-series/audit tables, and
 * dangling Docker images so a long-running instance doesn't slowly fill its disk.
 * Metrics retention is handled by the collector plugin.
 */
export default fp(
  async (fastify) => {
    let running = true;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      try {
        pruneOldLogs(LOG_MAX_AGE_MS);
        const now = Date.now();
        await fastify.db.delete(auditLog).where(lt(auditLog.ts, new Date(now - AUDIT_MAX_AGE_MS)));
        await fastify.db.delete(notificationLog).where(lt(notificationLog.ts, new Date(now - NOTIF_MAX_AGE_MS)));
        await pruneResetTokens(fastify.db);
        pruneDanglingImages();
      } catch (err) {
        fastify.log.error({ err }, 'housekeeping failed');
      } finally {
        if (running) {
          timer = setTimeout(() => void tick(), INTERVAL_MS);
          timer.unref();
        }
      }
    };

    fastify.addHook('onClose', async () => {
      running = false;
      clearTimeout(timer);
    });

    // Run once shortly after boot, then hourly.
    timer = setTimeout(() => void tick(), 60_000);
    timer.unref();
    fastify.log.info('housekeeping scheduler started');
  },
  { name: 'ninedeploy-housekeeping' },
);
