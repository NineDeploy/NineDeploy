import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { buildConfigs, databaseAttachments, databases, type DB, deployments, domains, envVars, services, sources } from '@ninedeploy/db';
import { config } from '../config.js';
import { decrypt } from '../lib/crypto.js';
import { checkoutCommit, type CloneCreds } from '../lib/git.js';
import { connectionString } from './database.js';
import { dockerBuilder } from './builders/docker.js';
import { logBus } from './logs.js';
import { pm2Builder } from './builders/pm2.js';
import { writeDynamicConfig } from './proxy.js';
import type { BuildContext, Builder, DeployRuntime } from './types.js';

const builders: Record<string, Builder> = { docker: dockerBuilder, pm2: pm2Builder };

/** Render any thrown value as a single-line message (handles non-Error rejections). */
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Collect runtime env vars: stored env vars + connection strings from attached databases. */
async function loadRuntimeEnv(db: DB, serviceId: number): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const rows = await db.query.envVars.findMany({ where: eq(envVars.serviceId, serviceId) });
  for (const r of rows) env[r.key] = decrypt(r.valueEncrypted);

  const attaches = await db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, serviceId) });
  for (const a of attaches) {
    const d = await db.query.databases.findFirst({ where: eq(databases.id, a.databaseId) });
    if (d && d.status === 'running') env[a.envAlias] = connectionString(d);
  }
  return env;
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

/** Run the full deploy pipeline for one deployment row. */
export async function runDeployment(db: DB, deploymentId: number): Promise<void> {
  const dep = await db.query.deployments.findFirst({ where: eq(deployments.id, deploymentId) });
  if (!dep) return;
  const service = await db.query.services.findFirst({ where: eq(services.id, dep.serviceId) });
  if (!service) return;
  const buildConfig = await db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, service.id) });

  const log = (line: string) => logBus.publish(deploymentId, line);
  await db.update(deployments).set({ status: 'building', startedAt: new Date() }).where(eq(deployments.id, deploymentId));
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

    const ctx: BuildContext = {
      deploymentId,
      service,
      buildConfig: buildConfig ?? undefined,
      workDir,
      commitSha: sha,
      // For image rollback, pin the exact image by its stored digest.
      imageDigest: dep.imageDigest ?? undefined,
      env: await loadRuntimeEnv(db, service.id),
      log,
    };
    runtime = await builder.buildAndRun(ctx, previous);

    log('Running healthcheck …');
    const healthy = await builder.isHealthy(runtime);
    if (!healthy) throw new Error('Healthcheck failed — service did not become ready in time');
  } catch (err) {
    log(`✗ Deployment failed: ${msg(err)}`);

    // Clean up the failed NEW runtime (if one was created).
    if (runtime) await builder.stop(runtime.runtimeId).catch(() => undefined);

    // Rollback: if the PREVIOUS runtime is still alive, the service keeps
    // serving the old version (Docker blue-green — the old container was never
    // stopped). For PM2 the previous process was already stopped, so the
    // service is down. Probe the previous with a short timeout to decide.
    let restored = false;
    if (previous) {
      try {
        restored = await builder.isHealthy(previous, 3000);
      } catch {
        restored = false;
      }
    }

    if (restored) {
      log('↩ Previous runtime is still healthy — rolled back to it.');
      // The service keeps serving the old version (status: running); the
      // deployment itself still failed and is recorded as such.
      await db.update(services).set({ status: 'running' }).where(eq(services.id, service.id));
      await db.update(deployments).set({ status: 'failed', finishedAt: new Date() }).where(eq(deployments.id, deploymentId));
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
  await db.update(deployments).set({ status: 'running', finishedAt: new Date(), imageDigest: runtime!.imageDigest ?? null }).where(eq(deployments.id, deploymentId));

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
  await writeDynamicConfig(db).catch((err) => log(`proxy warning: ${msg(err)}`));
  if (previous) {
    await builder.stop(previous.runtimeId).catch((err) => log(`finalize warning (previous stop): ${msg(err)}`));
  }
  log('✓ Deployment successful');
}
