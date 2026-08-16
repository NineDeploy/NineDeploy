import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { buildConfigs, databaseAttachments, databases, type DB, deployments, domains, envVars, services, sources } from '@ninedeploy/db';
import { config } from '../config.js';
import { decrypt } from '../lib/crypto.js';
import { checkoutCommit, type CloneCreds } from '../lib/git.js';
import { connectionString } from './database.js';
import { dockerBuilder } from './builders/docker.js';
import { composeBuilder } from './builders/compose.js';
import { logBus } from './logs.js';
import { pm2Builder } from './builders/pm2.js';
import { writeDynamicConfig } from './proxy.js';
import { sleep } from '../lib/exec.js';
import { resolveVaultRefs } from '../lib/vault.js';
import { agentOp } from '../lib/agentClient.js';
import type { BuildContext, Builder, DeployRuntime } from './types.js';

const builders: Record<string, Builder> = { docker: dockerBuilder, pm2: pm2Builder, compose: composeBuilder };

/** Render any thrown value as a single-line message (handles non-Error rejections). */
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Thrown at pipeline checkpoints when the deployment was cancelled mid-flight. */
class DeploymentCancelled extends Error {
  constructor() {
    super('Deployment cancelled');
  }
}

/** Re-read the deployment row — a cancel route may have flipped it mid-flight. */
async function isCancelled(db: DB, deploymentId: number): Promise<boolean> {
  const row = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
  return row?.status === 'cancelled';
}

/** Collect runtime env vars: shared project env ← service env ← attached-database
 * connection strings (later wins), then resolve `${{provider:KEY}}` vault refs. */
async function loadRuntimeEnv(db: DB, service: typeof services.$inferSelect): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  // Project-scope shared env (lowest precedence).
  if (service.projectId != null) {
    const shared = await db.query.envVars.findMany({
      where: and(eq(envVars.scope, 'project'), eq(envVars.scopeKey, service.projectId)),
    });
    for (const r of shared) env[r.key] = decrypt(r.valueEncrypted);
  }

  // Service-scope env overrides shared values.
  const rows = await db.query.envVars.findMany({ where: eq(envVars.serviceId, service.id) });
  for (const r of rows) env[r.key] = decrypt(r.valueEncrypted);

  const attaches = await db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, service.id) });
  for (const a of attaches) {
    const d = await db.query.databases.findFirst({ where: eq(databases.id, a.databaseId) });
    if (d && d.status === 'running') env[a.envAlias] = connectionString(d);
  }

  // Vault references resolve last, from the fully-merged map.
  return resolveVaultRefs(db, env);
}

/**
 * Resolve private-registry credentials for a service: when the service's
 * source is a registry-type source with a token, image pulls authenticate
 * with (registryUsername, token). The registry host defaults to the image's
 * own namespace (e.g. ghcr.io/...) or the Docker Hub default.
 */
async function loadRegistryAuth(
  db: DB,
  service: typeof services.$inferSelect,
): Promise<{ username: string; password: string; server?: string } | undefined> {
  if (!service.sourceId || !service.image) return undefined;
  const src = await db.query.sources.findFirst({ where: eq(sources.id, service.sourceId) });
  if (src?.type !== 'registry') return undefined;
  const username = src.registryUsername ?? '';
  const password = src.tokenEncrypted ? decrypt(src.tokenEncrypted) : '';
  if (!username || !password) return undefined;
  // The first path segment of namespaced images (ghcr.io/org/app) is the
  // registry host; bare names (nginx:latest) use the Docker Hub default.
  const parts = service.image.split('/');
  const first = parts.length > 1 ? parts[0]! : '';
  const isHost = first.includes('.') || first.includes(':');
  const server = first !== '' && isHost ? first : undefined;
  return { username, password, server };
}

/**
 * Mark a deployment failed and the service errored — without throwing. A DB
 * error during failure handling must never propagate (it would leave the worker
 * tick in a broken state and the deployment stuck in `building`).
 */
async function safeFail(db: DB, deploymentId: number, serviceId: number, runtimeId: string | null): Promise<void> {
  try {
    await db.update(deployments).set({ status: 'failed', finishedAt: new Date() }).where(eq(deployments.id, deploymentId));
  } catch (err) {
    logBus.publish(deploymentId, `failed to mark deployment failed: ${msg(err)}`);
  }
  try {
    await db.update(services).set({ status: 'error', runtimeId }).where(eq(services.id, serviceId));
  } catch (err) {
    logBus.publish(deploymentId, `failed to mark service errored: ${msg(err)}`);
  }
}

/**
 * Snapshot the effective build config + env key fingerprint for this deploy —
 * stored on the deployment row and diffed against the previous deployment to
 * answer "what changed between these two deploys?". Values are never included
 * (secrets); only key names + flags.
 */
async function snapshotConfig(
  db: DB,
  service: typeof services.$inferSelect,
  buildConfig: typeof buildConfigs.$inferSelect | undefined,
): Promise<string> {
  const envRows = await db.query.envVars.findMany({ where: eq(envVars.serviceId, service.id) });
  return JSON.stringify({
    buildPack: buildConfig?.buildPack ?? 'auto',
    baseDir: buildConfig?.baseDir ?? '/',
    installCmd: buildConfig?.installCmd ?? null,
    buildCmd: buildConfig?.buildCmd ?? null,
    startCmd: buildConfig?.startCmd ?? null,
    dockerfilePath: buildConfig?.dockerfilePath ?? null,
    restartPolicy: buildConfig?.restartPolicy ?? 'unless-stopped',
    stopGraceSeconds: buildConfig?.stopGraceSeconds ?? 5,
    image: service.image ?? null,
    port: service.port ?? null,
    envKeys: envRows.map((r) => `${r.key}${r.isSecret ? '*' : ''}`).sort(),
  });
}

/** Run the full deploy pipeline for one deployment row. */
export async function runDeployment(db: DB, deploymentId: number): Promise<void> {
  const dep = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
  if (!dep) return;
  const service = await db.query.services.findFirst({ where: eq(services.id, dep.serviceId) });
  if (!service) return;
  const buildConfig = await db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, service.id) });
  const configSnapshot = await snapshotConfig(db, service, buildConfig);

  const log = (line: string) => logBus.publish(deploymentId, line);
  await db
    .update(deployments)
    .set({ status: 'building', startedAt: new Date(), configSnapshot })
    .where(eq(deployments.id, deploymentId));
  await db.update(services).set({ status: 'deploying' }).where(eq(services.id, service.id));
  log(`▶ Deployment #${deploymentId} for "${service.name}" (${service.type})`);

  const builder = builders[service.type];
  if (!builder) {
    log(`✗ Unknown service type: ${service.type}`);
    await safeFail(db, deploymentId, service.id, service.runtimeId);
    return;
  }

  const workDir = path.join(config.paths.reposDir, String(service.id));

  // The currently-running runtime, if any. For Docker blue-green it keeps
  // serving traffic until the new container is healthy; for PM2 it is stopped
  // inside buildAndRun before the new one starts.
  const previous: DeployRuntime | undefined = service.runtimeId
    ? { runtimeId: service.runtimeId, port: service.port ?? null, healthPath: service.healthPath ?? '/' }
    : undefined;

  let runtime: DeployRuntime | undefined;
  // Resolved commit SHA (empty for image deploys). Lifted out of the try so the
  // success path (which persists it onto the service row) can read it.
  let sha = '';
  try {
    // Cancel checkpoint: the route may have flipped the row between claim and here.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();

    // Image-based deploys skip git entirely; repo-based deploys resolve creds + checkout.
    if (service.image) {
      log(`Image deploy from ${service.image}`);
    } else {
      let creds: CloneCreds | undefined;
      if (service.sourceId) {
        const src = await db.query.sources.findFirst({ where: eq(sources.id, service.sourceId) });
        if (src) {
          creds = {
            type: src.type,
            token: src.tokenEncrypted ? decrypt(src.tokenEncrypted) : undefined,
            deployKey: src.deployKeyEncrypted ? decrypt(src.deployKeyEncrypted) : undefined,
          };
        }
      }
      sha = await checkoutCommit(service.repoUrl ?? '', service.branch, dep.commitSha ?? undefined, workDir, log, creds);
      await db.update(deployments).set({ commitSha: sha }).where(eq(deployments.id, deploymentId));
    }

    // Cancel checkpoint: checkout can take minutes on big repos.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();

    const ctx: BuildContext = {
      deploymentId,
      service,
      buildConfig: buildConfig ?? undefined,
      workDir,
      commitSha: sha,
      // For image rollback, pin the exact image by its stored digest.
      imageDigest: dep.imageDigest ?? undefined,
      env: await loadRuntimeEnv(db, service),
      // Registry-type sources provide private-image credentials.
      registryAuth: await loadRegistryAuth(db, service),
      // Remote deploys: route builder operations through the typed agent.
      serverId: service.serverId ?? undefined,
      agentCall: service.serverId
        ? (op, params, sink) => agentOp(db, service.serverId!, op, params, sink)
        : undefined,
      log,
    };
    runtime = await builder.buildAndRun(ctx, previous);

    // Cancel checkpoint: the build finished, but the healthcheck (up to 5 min)
    // is the most likely place for a user-initiated cancel to land.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();

    log('Running healthcheck …');
    const healthy = await builder.isHealthy(runtime, 300_000, 10_000, log);
    if (!healthy) throw new Error('Healthcheck failed — service did not become ready in time');

    // Cancel checkpoint: last one before the success writes.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();
  } catch (err) {
    const cancelled = err instanceof DeploymentCancelled;
    log(cancelled ? '⏹ Deployment cancelled' : `✗ Deployment failed: ${msg(err)}`);

    // Clean up the failed/cancelled NEW runtime (if one was created).
    if (runtime) await builder.stop(runtime.runtimeId).catch(() => undefined);

    // Rollback: if the PREVIOUS runtime is still alive, the service keeps
    // serving the old version (Docker blue-green — the old container was never
    // stopped). For PM2 the previous process was already stopped, so the
    // service is down. Probe the previous with a short timeout to decide.
    let restored = false;
    if (previous) {
      try {
        restored = await builder.isHealthy(previous, 3000, 0, log);
      } catch {
        restored = false;
      }
    }

    if (restored) {
      log('↩ Previous runtime is still healthy — rolled back to it.');
      // The service keeps serving the old version (status: running); the
      // deployment itself still failed and is recorded as such.
      await db.update(services).set({ status: 'running' }).where(eq(services.id, service.id));
      await db.update(deployments).set({ status: cancelled ? 'cancelled' : 'failed', finishedAt: new Date() }).where(eq(deployments.id, deploymentId));
    } else if (cancelled) {
      // No previous runtime to fall back on — the service simply never came up.
      await db.update(services).set({ status: 'idle' }).where(eq(services.id, service.id));
      await db.update(deployments).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(deployments.id, deploymentId));
    } else {
      await safeFail(db, deploymentId, service.id, null);
    }
    return;
  }

  // ── SUCCESS PATH (outside the try, so a post-success hiccup can never kill
  // the healthy new container). The status writes are not wrapped: a failure
  // here propagates to the worker tick, which is correct — but the container is
  // already running. Only the post-success side-effects are best-effort. ──────
  const newRuntimeId = runtime!.runtimeId;
  await db
    .update(services)
    .set({ status: 'running', runtimeId: newRuntimeId, port: runtime!.port ?? null, commitSha: sha })
    .where(eq(services.id, service.id));
  // Conditional on still being `building`: a cancel that landed between the
  // last checkpoint and this write must not be overwritten with `running`.
  const finalized = await db
    .update(deployments)
    .set({ status: 'running', finishedAt: new Date(), imageDigest: runtime!.imageDigest ?? null })
    .where(and(eq(deployments.id, deploymentId), eq(deployments.status, 'building')))
    .returning({ id: deployments.id });
  if (finalized.length === 0) {
    log('⏹ Cancelled just before finalizing — retiring the new container, the previous stays live');
    await builder.stop(newRuntimeId).catch(() => undefined);
    if (previous) {
      await db.update(services).set({ status: 'running', runtimeId: previous.runtimeId }).where(eq(services.id, service.id));
    }
    return;
  }

  // Auto-provision wildcard domain if configured and not already present.
  // Isolated: a failure here must not affect the already-running container.
  if (config.wildcardDomain) {
    try {
      const wildcardHost = `${service.slug}.${config.wildcardDomain}`;
      const existing = await db.query.domains.findFirst({ where: and(eq(domains.serviceId, service.id), eq(domains.hostname, wildcardHost)) });
      if (!existing) {
        await db.insert(domains).values({ serviceId: service.id, hostname: wildcardHost, path: '/', ssl: false, status: 'active' });
        log(`🌐 Auto-assigned URL: ${wildcardHost}`);
      }
    } catch (err) {
      log(`warning: could not auto-assign wildcard domain: ${msg(err)}`);
    }
  }

  // Flip routing to the NEW container first, then stop the old one (blue-green
  // finalize). For PM2 the previous was already stopped inside buildAndRun, so
  // this stop is a harmless no-op.
  // IMPORTANT: only stop the previous container when routing actually flipped —
  // otherwise we'd kill the still-serving old version and cause an outage.
  let routingFlipped = false;
  try {
    await writeDynamicConfig(db);
    routingFlipped = true;
  } catch (err) {
    log(`proxy warning: ${msg(err)}`);
  }
  if (previous) {
    // Only retire the previous container once routing has actually flipped to
    // the new one — otherwise we'd stop the still-serving version and cause an
    // outage. If the config write failed, leave the previous container live.
    if (routingFlipped) {
      // Give Traefik's file watcher a moment to apply the new config before
      // retiring the old container — otherwise its reload latency could 502
      // requests still routed to the previous version.
      await sleep(2000);
      await builder
        .stop(previous.runtimeId, { graceSeconds: buildConfig?.stopGraceSeconds })
        .catch((err) => log(`finalize warning (previous stop): ${msg(err)}`));
    } else {
      log('↩ finalize skipped: routing did not flip, the previous container stays live');
    }
  }
  log('✓ Deployment successful');
}
