import { and, lt, notInArray } from 'drizzle-orm';
import { auditLog, deployments, jobRuns, notificationLog } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { run } from '../lib/exec.js';
import { deleteLog, pruneOldLogs } from '../engine/logs.js';
import { pruneResetTokens } from '../lib/passwordReset.js';
import { executeAutoPrune, getAutoPruneStatus } from '../engine/autoPrune.js';

const swallow = () => {};
const INTERVAL_MS = 60 * 60 * 1000; // hourly
/** Deploy-log files older than this are deleted. */
const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Audit rows older than this are deleted. */
const AUDIT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
/** Notification-log rows older than this are deleted. */
const NOTIF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/**
 * Finished deployment rows older than this are deleted.
 *
 * Deliberately the SAME window as `LOG_MAX_AGE_MS`. Log files were swept at 30
 * days and the rows they belonged to were never swept at all, so the older half
 * of every service's Deploys tab listed builds whose logs had already been
 * deleted — a history entry you can click and learn nothing from. Ageing the
 * row out with its log keeps the two in step.
 */
const DEPLOY_MAX_AGE_MS = LOG_MAX_AGE_MS;
/**
 * Scheduled-job run rows older than this are deleted.
 *
 * `job_runs` had no retention at all, and each row stores up to 60 KB of the
 * command's captured output (`lib/jobRunner.ts`) inside the SQLite file that
 * gets backed up whole. A per-minute cron job writes ~525 000 rows a year, and
 * the panel only ever renders the newest 20 per job — everything older was
 * unreadable weight. Same window as the other logs.
 */
const JOB_RUN_MAX_AGE_MS = LOG_MAX_AGE_MS;
/**
 * Never swept, whatever their age:
 *   • the in-flight statuses — the worker and the pipeline still write to them;
 *   • `running` — that row records what is serving traffic right now, carries
 *     the image digest a rollback re-deploys, and is the baseline the next
 *     deploy's config diff is taken against.
 */
const UNSWEEPABLE_STATUSES = ['queued', 'building', 'deploying', 'running'] as const;

/**
 * Delete finished deployment rows past the retention window, and the log file
 * of each one. Returns the number of rows removed.
 *
 * The ids are read first so the matching log files can be removed too:
 * `pruneOldLogs` only judges files by mtime, and a deployment that produced no
 * output in its final 30 days would otherwise leave its row deleted and its
 * file behind (or the reverse).
 */
async function pruneOldDeployments(db: import('@ninedeploy/db').DB, maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const doomed = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(lt(deployments.createdAt, cutoff), notInArray(deployments.status, [...UNSWEEPABLE_STATUSES])));
  if (doomed.length === 0) return 0;
  await db
    .delete(deployments)
    .where(and(lt(deployments.createdAt, cutoff), notInArray(deployments.status, [...UNSWEEPABLE_STATUSES])));
  for (const row of doomed) deleteLog(row.id);
  return doomed.length;
}

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
 * Periodic housekeeping: prunes deploy-log files, finished deployment rows,
 * scheduled-job run history, time-series/audit tables, and dangling Docker
 * images so a long-running instance doesn't slowly fill its disk. Metrics
 * retention is handled by the collector plugin.
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
        await pruneOldDeployments(fastify.db, DEPLOY_MAX_AGE_MS);
        await fastify.db.delete(jobRuns).where(lt(jobRuns.createdAt, new Date(now - JOB_RUN_MAX_AGE_MS)));
        await pruneResetTokens(fastify.db);
        pruneDanglingImages();

        // Disk Auto-Prune check
        const pruneStatus = await getAutoPruneStatus(fastify.db);
        if (pruneStatus.enabled && pruneStatus.diskUsedPercent >= pruneStatus.thresholdPercent) {
          fastify.log.warn(
            { diskUsedPercent: pruneStatus.diskUsedPercent, thresholdPercent: pruneStatus.thresholdPercent },
            'Disk threshold reached — triggering auto-prune',
          );
          await executeAutoPrune(fastify.db);
        }
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
