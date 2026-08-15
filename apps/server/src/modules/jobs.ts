import { and, desc, eq } from 'drizzle-orm';
import { jobRuns, scheduledJobs, services } from '@ninedeploy/db';
import { jobCreate, jobPatch } from '@ninedeploy/schemas';
import type { FastifyPluginAsync } from 'fastify';
import { Cron } from 'croner';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, parseId } from '../lib/errors.js';
import { runJob } from '../lib/jobRunner.js';

/** Validate a 5-field cron expression up front (croner is the runtime parser). */
function assertCron(expr: string): void {
  try {
    new Cron(expr, { paused: true });
  } catch {
    throw badRequest('Invalid cron expression (expected 5 fields: minute hour day month weekday)');
  }
}

function serializeJob(j: typeof scheduledJobs.$inferSelect) {
  return {
    id: j.id,
    serviceId: j.serviceId,
    name: j.name,
    cron: j.cron,
    kind: j.kind,
    command: j.command ?? '',
    enabled: j.enabled,
    lastRunAt: j.lastRunAt ? j.lastRunAt.toISOString() : null,
    createdAt: j.createdAt.toISOString(),
  };
}

/** Scheduled jobs (cron) for a service: redeploys or container commands. */
export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/jobs', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const rows = await app.db.query.scheduledJobs.findMany({
      where: eq(scheduledJobs.serviceId, id),
      orderBy: desc(scheduledJobs.createdAt),
    });
    return rows.map(serializeJob);
  });

  app.post('/:id/jobs', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    const input = jobCreate.parse(req.body ?? {});
    assertCron(input.cron);
    if (input.kind === 'exec' && !input.command) throw badRequest('command is required for exec jobs');

    const [row] = await app.db
      .insert(scheduledJobs)
      .values({
        serviceId: id,
        name: input.name,
        cron: input.cron,
        kind: input.kind,
        command: input.kind === 'exec' ? input.command : null,
        enabled: input.enabled,
      })
      .returning();
    if (!row) throw badRequest('Could not create job');
    void audit(app.db, req.user!.id, 'job.create', input.name);
    return serializeJob(row);
  });

  app.patch('/:id/jobs/:jobId', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const jobId = parseId((req.params as { jobId: string }).jobId);
    const input = jobPatch.parse(req.body ?? {});
    const values: Partial<typeof scheduledJobs.$inferInsert> = {};
    if (input.name?.trim()) values.name = input.name.trim();
    if (input.cron?.trim()) {
      assertCron(input.cron.trim());
      values.cron = input.cron.trim();
    }
    if (input.kind !== undefined) values.kind = input.kind;
    if (input.command !== undefined) values.command = input.command.trim() || null;
    if (input.enabled !== undefined) values.enabled = input.enabled;
    const [row] = await app.db
      .update(scheduledJobs)
      .set(values)
      .where(and(eq(scheduledJobs.id, jobId), eq(scheduledJobs.serviceId, id)))
      .returning();
    if (!row) throw notFound('Job not found');
    void audit(app.db, req.user!.id, 'job.update', row.name);
    return serializeJob(row);
  });

  app.delete('/:id/jobs/:jobId', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const jobId = parseId((req.params as { jobId: string }).jobId);
    await app.db.delete(scheduledJobs).where(and(eq(scheduledJobs.id, jobId), eq(scheduledJobs.serviceId, id)));
    void audit(app.db, req.user!.id, 'job.delete', `#${jobId}`);
    return { ok: true };
  });

  // Run immediately, ignoring the cron schedule.
  app.post('/:id/jobs/:jobId/run', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const jobId = parseId((req.params as { jobId: string }).jobId);
    const job = await app.db.query.scheduledJobs.findFirst({
      where: and(eq(scheduledJobs.id, jobId), eq(scheduledJobs.serviceId, id)),
    });
    if (!job) throw notFound('Job not found');
    await runJob(app.db, jobId);
    void audit(app.db, req.user!.id, 'job.run', job.name);
    return { ok: true };
  });

  // Run history for one job (latest 20).
  app.get('/:id/jobs/:jobId/runs', async (req) => {
    const jobId = parseId((req.params as { jobId: string }).jobId);
    const rows = await app.db.query.jobRuns.findMany({
      where: eq(jobRuns.jobId, jobId),
      orderBy: desc(jobRuns.createdAt),
      limit: 20,
    });
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      status: r.status,
      output: r.output,
      exitCode: r.exitCode,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  });
};
