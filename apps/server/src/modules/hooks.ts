import { and, eq, inArray } from 'drizzle-orm';
import { deployments, services, webhooks } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { webhookCreate } from '@ninedeploy/schemas';
import { config } from '../config.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { parseId, unauthorized } from '../lib/errors.js';
import { isPing, parsePush, verifyWebhook } from '../lib/webhooks.js';

/** Public webhook receiver — auto-deploys on verified provider push events. */
export const hookReceiveRoutes: FastifyPluginAsync = async (app) => {
  // Public endpoint (auth bypassed, verified by HMAC) — cap flood attempts.
  app.post('/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    // Public receiver: leave non-numeric ids as NaN so they 404 ("Unknown
    // webhook") rather than 400 — don't reveal param validation to probers.
    const id = Number((req.params as { id: string }).id);
    const hook = await app.db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
    if (!hook || !hook.active) return reply.code(404).send({ error: { code: 'not_found', message: 'Unknown webhook' } });

    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const secret = decrypt(hook.secretEncrypted);
    const provider = verifyWebhook(req.headers, rawBody, secret);
    if (!provider) throw unauthorized('Invalid webhook signature');

    if (isPing(req.headers, provider)) return { ok: 'pong' };

    const push = parsePush(req.body, provider);
    if (!push) return { ok: 'ignored', reason: 'not_a_push' };

    if (push.branch !== hook.branch) return { ok: 'skipped', reason: 'branch', branch: push.branch };

    // Replay dedup: a captured valid push replays indefinitely (the HMAC covers
    // the body, not freshness). Skip when a deployment for this exact commit is
    // already queued/building/running for the service, so a re-sent payload
    // cannot flood the deploy queue.
    if (push.sha) {
      const existing = await app.db.query.deployments.findFirst({
        where: and(
          eq(deployments.serviceId, hook.serviceId),
          eq(deployments.commitSha, push.sha),
          inArray(deployments.status, ['queued', 'building', 'running']),
        ),
      });
      if (existing) return { ok: 'skipped', reason: 'duplicate', deploymentId: existing.id };
    }

    const [dep] = await app.db
      .insert(deployments)
      .values({
        serviceId: hook.serviceId,
        status: 'queued',
        trigger: 'webhook',
        commitSha: push.sha || null,
        message: push.message || null,
        author: push.author || null,
      })
      .returning();
    return { ok: true, provider, deploymentId: dep!.id };
  });
};

/** Authed webhook management for a service. Mounted under /services. */
export const webhookMgmtRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/webhooks', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const rows = await app.db.query.webhooks.findMany({ where: eq(webhooks.serviceId, id) });
    return rows.map((w) => ({
      id: w.id,
      branch: w.branch,
      active: w.active,
      url: webhookUrl(w.id),
      createdAt: w.createdAt.toISOString(),
    }));
  });

  app.post('/:id/webhooks', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = webhookCreate.parse(req.body ?? {});
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw unauthorized('Service not found');
    const branch = input.branch?.trim() || svc.branch;
    const secret = randomToken(24);
    const [w] = await app.db
      .insert(webhooks)
      .values({ serviceId: id, branch, secretEncrypted: encrypt(secret), active: true })
      .returning();
    // The raw secret is returned exactly once.
    return { id: w!.id, branch: w!.branch, active: w!.active, url: webhookUrl(w!.id), secret };
  });

  app.delete('/:id/webhooks/:hookId', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const hookId = parseId((req.params as { hookId: string }).hookId);
    await app.db.delete(webhooks).where(and(eq(webhooks.id, hookId), eq(webhooks.serviceId, id)));
    return { ok: true };
  });
};

function webhookUrl(id: number): string {
  return `${config.publicUrl}/v1/hooks/${id}`;
}
