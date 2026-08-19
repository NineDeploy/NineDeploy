import { and, desc, eq, inArray } from 'drizzle-orm';
import { buildConfigs, deployments, domains, envVars, services, webhooks } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { webhookCreate } from '@ninedeploy/schemas';
import { config } from '../config.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { matchesAny, parseWatchPaths } from '../lib/glob.js';
import { parseId, notFound, unauthorized } from '../lib/errors.js';
import { isPing, isPullRequest, parsePullRequest, parsePush, verifyWebhook } from '../lib/webhooks.js';
import { loadServiceForUser } from '../lib/serviceAccess.js';
import { dockerBuilder } from '../engine/builders/docker.js';
import { pm2Builder } from '../engine/builders/pm2.js';
import { composeBuilder } from '../engine/builders/compose.js';
import { writeDynamicConfig } from '../engine/proxy.js';

async function stopRuntimeFor(service: { runtimeId: string | null; type: string }) {
  if (!service.runtimeId) return;
  try {
    if (service.type === 'docker') await dockerBuilder.stop(service.runtimeId);
    else if (service.type === 'pm2') await pm2Builder.stop(service.runtimeId);
    else if (service.type === 'compose') await composeBuilder.stop(service.runtimeId);
  } catch {
    /* swallow runtime stop error */
  }
}

/** Public webhook receiver — auto-deploys on verified provider push & PR events. */
export const hookReceiveRoutes: FastifyPluginAsync = async (app) => {
  // Public endpoint (auth bypassed, verified by HMAC) — cap flood attempts.
  app.post('/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    // Public receiver: leave non-numeric ids as NaN so they 404 ("Unknown
    // webhook") rather than 400 — don't reveal param validation to probers.
    const id = Number((req.params as { id: string }).id);
    const hook = await app.db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
    if (!hook?.active) throw notFound('Unknown webhook');

    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const secret = decrypt(hook.secretEncrypted);
    const provider = verifyWebhook(req.headers, rawBody, secret);
    if (!provider) throw unauthorized('Invalid webhook signature');

    if (isPing(req.headers, provider)) return { ok: 'pong' };

    // ── Ephemeral PR / MR Preview Deployments ──────────────────────────────────
    if (isPullRequest(req.headers, provider)) {
      const pr = parsePullRequest(req.body, provider);
      if (!pr) return { ok: 'ignored', reason: 'not_a_valid_pr' };

      const parent = await app.db.query.services.findFirst({ where: eq(services.id, hook.serviceId) });
      if (!parent) throw notFound('Parent service not found');
      if (!parent.previewDeploymentsEnabled) {
        return { ok: 'skipped', reason: 'preview_deployments_disabled' };
      }

      const existingPreview = await app.db.query.services.findFirst({
        where: and(
          eq(services.previewParentServiceId, parent.id),
          eq(services.prNumber, pr.prNumber),
        ),
      });

      if (pr.action === 'closed') {
        if (!parent.previewAutoDestroyOnClose || !existingPreview) {
          return { ok: 'skipped', reason: existingPreview ? 'auto_destroy_disabled' : 'no_preview_found' };
        }
        await stopRuntimeFor(existingPreview);
        await app.db.delete(services).where(eq(services.id, existingPreview.id));
        try {
          await writeDynamicConfig(app.db);
        } catch {
          /* best effort */
        }
        return { ok: true, action: 'preview_destroyed', prNumber: pr.prNumber, serviceId: existingPreview.id };
      }

      // Opened / Synchronize / Reopened
      let targetService = existingPreview;
      if (!targetService) {
        // Enforce max active previews cap
        const activePreviews = await app.db.query.services.findMany({
          where: and(eq(services.previewParentServiceId, parent.id), eq(services.isEphemeralPreview, true)),
          orderBy: [desc(services.id)],
        });
        if (activePreviews.length >= parent.previewMaxActive && activePreviews.length > 0) {
          const oldest = activePreviews[activePreviews.length - 1]!;
          await stopRuntimeFor(oldest);
          await app.db.delete(services).where(eq(services.id, oldest.id));
        }

        const previewSlug = `${parent.slug}-pr-${pr.prNumber}`;
        const [created] = await app.db
          .insert(services)
          .values({
            projectId: parent.projectId,
            ownerUserId: parent.ownerUserId,
            name: `${parent.name} (PR #${pr.prNumber})`,
            slug: previewSlug,
            type: parent.type,
            status: 'idle',
            repoUrl: pr.repoUrl || parent.repoUrl,
            branch: pr.branch,
            commitSha: pr.sha,
            sourceId: parent.sourceId,
            image: parent.image,
            volumeMount: null,
            composeService: parent.composeService,
            port: parent.port,
            healthPath: parent.healthPath,
            cpuShares: parent.cpuShares,
            memLimitMb: parent.memLimitMb,
            isEphemeralPreview: true,
            previewParentServiceId: parent.id,
            prNumber: pr.prNumber,
          })
          .returning();
        targetService = created;

        // Copy parent build config
        const parentBuild = await app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, parent.id) });
        if (parentBuild && targetService) {
          await app.db.insert(buildConfigs).values({
            serviceId: targetService.id,
            buildPack: parentBuild.buildPack,
            baseDir: parentBuild.baseDir,
            installCmd: parentBuild.installCmd,
            buildCmd: parentBuild.buildCmd,
            startCmd: parentBuild.startCmd,
            dockerfilePath: parentBuild.dockerfilePath,
            preDeployCmd: parentBuild.preDeployCmd,
            postDeployCmd: parentBuild.postDeployCmd,
            preStopCmd: parentBuild.preStopCmd,
            restartPolicy: parentBuild.restartPolicy,
            stopGraceSeconds: parentBuild.stopGraceSeconds,
          });
        }

        // Copy parent service-scoped env vars
        if (targetService) {
          const parentEnvs = await app.db.query.envVars.findMany({ where: eq(envVars.serviceId, parent.id) });
          for (const env of parentEnvs) {
            await app.db.insert(envVars).values({
              serviceId: targetService.id,
              scope: 'service',
              scopeKey: targetService.id,
              key: env.key,
              valueEncrypted: env.valueEncrypted,
              isSecret: env.isSecret,
            });
          }

          // Provision preview domain
          const baseDomain = config.wildcardDomain || 'localhost';
          const pattern = parent.previewDomainPattern || 'pr-{{pr}}-{{slug}}.{{domain}}';
          const hostname = pattern
            .replace(/\{\{pr\}\}/g, String(pr.prNumber))
            .replace(/\{\{slug\}\}/g, parent.slug)
            .replace(/\{\{domain\}\}/g, baseDomain);

          await app.db.insert(domains).values({
            serviceId: targetService.id,
            hostname,
            path: '/',
            ssl: false,
          });
        }
      } else {
        await app.db.update(services).set({ branch: pr.branch, commitSha: pr.sha }).where(eq(services.id, targetService.id));
      }

      if (!targetService) return { ok: 'error', reason: 'failed_to_create_preview' };

      const [dep] = await app.db
        .insert(deployments)
        .values({
          serviceId: targetService.id,
          status: 'queued',
          trigger: 'webhook',
          commitSha: pr.sha || null,
          message: `PR #${pr.prNumber}: ${pr.title}`,
          author: pr.author || null,
        })
        .returning();

      return {
        ok: true,
        provider,
        action: 'preview_deployment_queued',
        previewServiceId: targetService.id,
        deploymentId: dep?.id,
        prNumber: pr.prNumber,
      };
    }

    // ── Standard Push Webhook ──────────────────────────────────────────────────
    const push = parsePush(req.body, provider);
    if (!push) return { ok: 'ignored', reason: 'not_a_push' };

    if (push.branch !== hook.branch) return { ok: 'skipped', reason: 'branch', branch: push.branch };

    // Skip markers: `[skip ci]` / `[skip cd]` in the head commit message opts
    // this push out of an automatic deploy (matches CI convention).
    if (push.message && /\[skip[ -](ci|cd)\]/i.test(push.message)) {
      return { ok: 'skipped', reason: 'skip_marker' };
    }

    // Watch paths (monorepos): when the webhook defines globs, deploy only if
    // at least one changed file matches. Payloads without file lists (rare)
    // still deploy — never silently block an unverifiable push.
    const patterns = parseWatchPaths(hook.watchPaths);
    if (patterns.length > 0 && push.changedFiles.length > 0) {
      const hit = push.changedFiles.some((f) => matchesAny(f, patterns));
      if (!hit) return { ok: 'skipped', reason: 'watch_paths', patterns: patterns.length };
    }

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
    // The check-then-insert above races under concurrent duplicate deliveries
    // (no unique index covers service+sha+status). Post-hoc guard: if another
    // active deployment for the same commit won, drop ours.
    if (dep && push.sha) {
      const dups = await app.db.query.deployments.findMany({
        where: and(
          eq(deployments.serviceId, hook.serviceId),
          eq(deployments.commitSha, push.sha),
          inArray(deployments.status, ['queued', 'building', 'running']),
        ),
      });
      const other = dups.filter((d) => d.id !== dep.id).sort((a, b) => a.id - b.id)[0];
      // Keep the lowest id (both racers converge on the same winner).
      if (other && other.id < dep.id) {
        await app.db.delete(deployments).where(eq(deployments.id, dep.id));
        return { ok: 'skipped', reason: 'duplicate', deploymentId: other.id };
      }
    }
    return { ok: true, provider, deploymentId: dep!.id };
  });
};

/** Authed webhook management for a service. Mounted under /services. */
export const webhookMgmtRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/webhooks', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    await loadServiceForUser(app.db, id, req.user!);
    const rows = await app.db.query.webhooks.findMany({ where: eq(webhooks.serviceId, id) });
    return rows.map((w) => ({
      id: w.id,
      branch: w.branch,
      active: w.active,
      watchPaths: w.watchPaths ?? '',
      url: webhookUrl(w.id),
      createdAt: w.createdAt.toISOString(),
    }));
  });

  app.post('/:id/webhooks', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = webhookCreate.parse(req.body ?? {});
    const svc = await loadServiceForUser(app.db, id, req.user!);
    const branch = input.branch?.trim() || svc.branch;
    const secret = randomToken(24);
    const [w] = await app.db
      .insert(webhooks)
      .values({
        serviceId: id,
        branch,
        watchPaths: input.watchPaths?.trim() || null,
        secretEncrypted: encrypt(secret),
        active: true,
      })
      .returning();
    // The raw secret is returned exactly once.
    return { id: w!.id, branch: w!.branch, active: w!.active, url: webhookUrl(w!.id), secret };
  });

  app.delete('/:id/webhooks/:hookId', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const hookId = parseId((req.params as { hookId: string }).hookId);
    await loadServiceForUser(app.db, id, req.user!);
    await app.db.delete(webhooks).where(and(eq(webhooks.id, hookId), eq(webhooks.serviceId, id)));
    return { ok: true };
  });
};

function webhookUrl(id: number): string {
  return `${config.publicUrl}/v1/hooks/${id}`;
}
