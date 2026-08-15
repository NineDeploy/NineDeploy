import { eq } from 'drizzle-orm';
import { deployments, jobRuns, scheduledJobs, services, type DB } from '@ninedeploy/db';
import { run } from './exec.js';
import { audit } from './audit.js';

const MAX_OUTPUT = 60_000; // ~60 KB of captured output per run

/**
 * Execute one scheduled job now (used by both the cron scheduler and the
 * run-now route). `deploy` jobs enqueue a deployment (trigger: schedule);
 * `exec` jobs run a command inside the service's runtime container with the
 * output + exit code recorded on a job_runs row.
 */
export async function runJob(db: DB, jobId: number): Promise<void> {
  const job = await db.query.scheduledJobs.findFirst({ where: eq(scheduledJobs.id, jobId) });
  if (!job) return;

  await db.update(scheduledJobs).set({ lastRunAt: new Date() }).where(eq(scheduledJobs.id, job.id));
  const svc = await db.query.services.findFirst({ where: eq(services.id, job.serviceId) });
  if (!svc) return;

  if (job.kind === 'deploy') {
    // Delegated to the deployments table; the worker picks it up like any other.
    await db.insert(deployments).values({
      serviceId: job.serviceId,
      status: 'queued',
      trigger: 'schedule',
      message: `Scheduled job: ${job.name}`,
    });
    void audit(db, null, 'job.deploy', job.name);
    return;
  }

  // exec: run inside the runtime container — output + exit code recorded.
  if (!svc.runtimeId || !job.command) return;
  const [runRow] = await db
    .insert(jobRuns)
    .values({ jobId: job.id, status: 'running', startedAt: new Date() })
    .returning();
  const chunks: string[] = [];
  let length = 0;
  const sink = (line: string) => {
    length += line.length + 1;
    if (length <= MAX_OUTPUT) chunks.push(line);
  };
  let exitOk = true;
  try {
    await run('docker', ['exec', svc.runtimeId, 'sh', '-lc', job.command], {}, sink);
  } catch {
    exitOk = false;
  }
  await db
    .update(jobRuns)
    .set({
      status: exitOk ? 'completed' : 'failed',
      exitCode: exitOk ? 0 : 1,
      output: chunks.join('\n'),
      finishedAt: new Date(),
    })
    .where(eq(jobRuns.id, runRow!.id));
  void audit(db, null, exitOk ? 'job.exec' : 'job.exec_failed', job.name);
}
