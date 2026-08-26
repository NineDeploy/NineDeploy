import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { buildConfigs, databaseAttachments, databases, type DB, deployments, domains, envVars, services, serviceProjects, serviceVolumeAttachments, sources } from '@ninedeploy/db';
import { config } from '../config.js';
import { decrypt } from '../lib/crypto.js';
import { checkoutCommit, type CloneCreds } from '../lib/git.js';
import { analyzeRepo, summarizeInsights } from '../lib/frameworks.js';
import { upsertInsights } from './repoInsights.js';
import { connectionString, ENGINES } from './database.js';
import { dockerBuilder } from './builders/docker.js';
import { composeBuilder } from './builders/compose.js';
import { logBus } from './logs.js';
import { pm2Builder } from './builders/pm2.js';
import { getAcmeEmail, writeDynamicConfig } from './proxy.js';
import { run, sleep } from '../lib/exec.js';
import { resolveVaultRefs } from '../lib/vault.js';
import { agentOp } from '../lib/agentClient.js';
import { getBundledTemplates } from '../templates/registry.js';
import type { BuildContext, Builder, DeployRuntime } from './types.js';
import { reconcileTemplateDependencies } from './templateDependencies.js';
import { applyManifestToService } from '../lib/applyManifestToService.js';
import { loadNinedeployManifest } from '../lib/ninedeployManifest.js';

const builders: Record<string, Builder> = { docker: dockerBuilder, pm2: pm2Builder, compose: composeBuilder };
const DEPLOY_HEARTBEAT_MS = 20_000;

/** Execute a lifecycle hook command in the service workDir with resolved environment. */
async function runHook(cmd: string, cwd: string, env: Record<string, string>, log: (line: string) => void): Promise<void> {
  const [bin, ...args] = cmd.trim().split(/\s+/);
  if (!bin) return;
  await run(
    bin,
    args,
    { cwd, env, heartbeatMs: DEPLOY_HEARTBEAT_MS, heartbeatLabel: `Running deployment hook (${bin})` },
    log,
  );
}

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
type RuntimeEnvironment = {
  values: Record<string, string>;
  attachmentCount: number;
  readyAttachmentCount: number;
  managedDatabaseKeys: string[];
};

async function loadRuntimeEnv(db: DB, service: typeof services.$inferSelect): Promise<RuntimeEnvironment> {
  const env: Record<string, string> = {};
  const managedDatabaseKeys = new Set<string>();

  // Project-scope shared env (lowest precedence). Services now carry N-N
  // project links via `service_projects`; the env lookup is the union of every
  // linked project's `env_vars` (scope='project').
  const projectLinks = await db.query.serviceProjects.findMany({
    where: eq(serviceProjects.serviceId, service.id),
  });
  if (projectLinks.length > 0) {
    const shared = await db.query.envVars.findMany({
      where: and(
        eq(envVars.scope, 'project'),
        inArray(envVars.scopeKey, projectLinks.map((p) => p.projectId)),
      ),
    });
    for (const r of shared) env[r.key] = decrypt(r.valueEncrypted);
  }

  // Service-scope env overrides shared values.
  const rows = await db.query.envVars.findMany({ where: eq(envVars.serviceId, service.id) });
  for (const r of rows) env[r.key] = decrypt(r.valueEncrypted);

  const attaches = await db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, service.id) });
  let readyAttachmentCount = 0;
  for (const a of attaches) {
    const d = await db.query.databases.findFirst({ where: eq(databases.id, a.databaseId) });
    if (d && d.status === 'running') {
      readyAttachmentCount++;
      // Services created by an older or interrupted Hub flow may have a valid
      // attachment but a missing persisted mapping. Recover the trusted
      // built-in contract from the exact image/port/volume/database signature
      // instead of silently falling back to a generic URL the app may ignore.
      const bundledMapping = getBundledTemplates().find((template) =>
        template.image === service.image
        && template.port === service.port
        && (template.volumeMount ?? null) === (service.volumeMount ?? null)
        && template.dbEngine === d.engine
      )?.databaseEnv;
      const mapping = bundledMapping ?? service.templateDatabaseEnv;
      if (!mapping || Object.keys(mapping).length === 0) {
        env[a.envAlias] = connectionString(d);
        managedDatabaseKeys.add(a.envAlias);
        continue;
      }
      const cfg = ENGINES[d.engine];
      if (!cfg) continue;
      const host = d.internalHost ?? d.containerName ?? '';
      const port = d.internalPort ?? cfg.port;
      const username = cfg.username() ?? d.username ?? '';
      const password = d.passwordEncrypted ? decrypt(d.passwordEncrypted) : '';
      const database = cfg.dbName() ?? d.dbName ?? '';
      const values: Record<'url' | 'host' | 'hostPort' | 'port' | 'username' | 'password' | 'database', string> = {
        url: connectionString(d),
        host,
        hostPort: `${host}:${port}`,
        port: String(port),
        username,
        password,
        database,
      };
      for (const [key, source] of Object.entries(mapping)) {
        env[key] = values[source];
        managedDatabaseKeys.add(key);
      }
    }
  }

  // Vault references resolve last, from the fully-merged map.
  return {
    values: await resolveVaultRefs(db, env),
    attachmentCount: attaches.length,
    readyAttachmentCount,
    managedDatabaseKeys: [...managedDatabaseKeys].sort(),
  };
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
    preDeployCmd: buildConfig?.preDeployCmd ?? null,
    postDeployCmd: buildConfig?.postDeployCmd ?? null,
    preStopCmd: buildConfig?.preStopCmd ?? null,
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

    log('##[stage:PREPARE:running] Resolving repository, sources and workspace');
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

      // Framework analysis powers the service-detail cards and gives the deploy
      // log a human-readable "what is this repo" line. Best-effort by design —
      // a detection hiccup must never fail the deploy itself.
      try {
        const insights = analyzeRepo(workDir, buildConfig?.baseDir, sha);
        await upsertInsights(db, service.id, insights);
        log(summarizeInsights(insights));
      } catch (err) {
        log(`warning: repository analysis failed: ${msg(err)}`);
      }

      // `.ninedeploy` operational side: after a successful checkout, push the
      // manifest's routes/database/alerts into the service config so the panel
      // reflects what the repo declares. Idempotent — re-running an unchanged
      // manifest is a no-op. Best-effort: a stale manifest must never fail
      // the deploy itself.
      try {
        const loaded = loadNinedeployManifest(workDir);
        if (loaded) {
          log(
            `📋 .ninedeploy loaded (${loaded.relativePath}) — applying operational sections`,
          );
          const applyResult = await applyManifestToService(db, service.id, loaded.manifest, service.ownerUserId);
          log(
            `📋 .ninedeploy applied: routes=${applyResult.routesUpserted}, alerts=${applyResult.alertsUpserted}, dbAttached=${applyResult.databaseAttached}`,
          );
          for (const w of applyResult.warnings) {
            log(`📋 .ninedeploy note: ${w}`);
          }
        }
      } catch (err) {
        log(`warning: .ninedeploy apply failed: ${msg(err)}`);
      }
    }
    log('##[stage:PREPARE:success]');

    // Cancel checkpoint: checkout can take minutes on big repos.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();

    if (service.templateId) {
      log('##[stage:DEPENDENCIES:running] Reconciling managed template dependencies');
      const dependency = await reconcileTemplateDependencies(db, service, log);
      if (dependency) {
        log(`Managed database ${dependency.database.slug} is running and attached`);
      }
      log('##[stage:DEPENDENCIES:success]');
    }

    const runtimeEnvironment = await loadRuntimeEnv(db, service);
    if (runtimeEnvironment.readyAttachmentCount !== runtimeEnvironment.attachmentCount) {
      throw new Error(
        `Managed database dependency is not ready (${runtimeEnvironment.readyAttachmentCount}/${runtimeEnvironment.attachmentCount} attachments running)`,
      );
    }
    if (runtimeEnvironment.managedDatabaseKeys.length > 0) {
      log(`Managed database environment ready: ${runtimeEnvironment.managedDatabaseKeys.join(', ')}`);
    }

    const ctx: BuildContext = {
      deploymentId,
      service,
      buildConfig: buildConfig ?? undefined,
      workDir,
      commitSha: sha,
      // For image rollback, pin the exact image by its stored digest.
      imageDigest: dep.imageDigest ?? undefined,
      env: runtimeEnvironment.values,
      // Registry-type sources provide private-image credentials.
      registryAuth: await loadRegistryAuth(db, service),
      // Remote deploys: route builder operations through the typed agent.
      serverId: service.serverId ?? undefined,
      agentCall: service.serverId
        ? (op, params, sink) => agentOp(db, service.serverId!, op, params, sink)
        : undefined,
      // Additional named-volume attachments. Loaded fresh on every deploy so
      // a mid-flight attach (before this deployment claims its slot) is
      // reflected in the next run, but NOT in any already-queued deployment
      // (the deployment row pins the configuration snapshot).
      volumeAttachments: await db
        .select()
        .from(serviceVolumeAttachments)
        .where(eq(serviceVolumeAttachments.serviceId, service.id)),
      log,
    };

    if (buildConfig?.preDeployCmd) {
      log(`▶ Running Pre-Deploy Hook: ${buildConfig.preDeployCmd} …`);
      await runHook(buildConfig.preDeployCmd, workDir, ctx.env, log);
    }

    log('##[stage:BUILD:running] Building image and compiling dependencies');
    runtime = await builder.buildAndRun(ctx, previous);
    log('##[stage:BUILD:success]');
    log('##[stage:BOOT:success] Container runtime launched in isolated sandbox');

    // Cancel checkpoint: the build finished, but the healthcheck (up to 5 min)
    // is the most likely place for a user-initiated cancel to land.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();

    log('##[stage:HEALTHCHECK:running] Probing container HTTP healthcheck');
    log('Running healthcheck …');
    const healthy = await builder.isHealthy(runtime, 300_000, 10_000, log);
    if (!healthy) throw new Error('Healthcheck failed — service did not become ready in time');
    log('##[stage:HEALTHCHECK:success]');

    if (buildConfig?.postDeployCmd) {
      log(`▶ Running Post-Deploy Hook: ${buildConfig.postDeployCmd} …`);
      try {
        await runHook(buildConfig.postDeployCmd, workDir, ctx.env, log);
      } catch (err) {
        log(`warning: post-deploy hook failed: ${msg(err)}`);
      }
    }

    // Cancel checkpoint: last one before the success writes.
    if (await isCancelled(db, deploymentId)) throw new DeploymentCancelled();
  } catch (err) {
    const cancelled = err instanceof DeploymentCancelled;
    log(cancelled ? '⏹ Deployment cancelled' : `✗ Deployment failed: ${msg(err)}`);
    log('##[stage:ERROR:failed]');

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
  // In-place redeploys (compose) recreate the runtime under the SAME
  // deterministic id: once buildAndRun returns, "previous" and "new" are the
  // same live instance. Retiring that id afterwards would tear down the
  // deployment that just went live (`docker compose down --remove-orphans`).
  const inPlaceRedeploy = previous !== undefined && previous.runtimeId === newRuntimeId;
  // Conditional on still being `building`: a cancel that landed between the
  // last checkpoint and the finalize must not be overwritten with `running`.
  // This runs FIRST — otherwise the service row below could end up pointing
  // at a container that a late cancel then retires.
  const finalized = await db
    .update(deployments)
    .set({ status: 'running', finishedAt: new Date(), imageDigest: runtime!.imageDigest ?? null })
    .where(and(eq(deployments.id, deploymentId), eq(deployments.status, 'building')))
    .returning({ id: deployments.id });
  if (finalized.length === 0) {
    if (!inPlaceRedeploy) {
      log('⏹ Cancelled just before finalizing — retiring the new container, the previous stays live');
      await builder.stop(newRuntimeId).catch(() => undefined);
      if (previous) {
        await db.update(services).set({ status: 'running', runtimeId: previous.runtimeId }).where(eq(services.id, service.id));
      } else {
        // First-ever deploy cancelled at the wire: nothing is running.
        await db.update(services).set({ status: 'idle' }).where(eq(services.id, service.id));
      }
    } else {
      // The swap already happened under a shared runtime id and cannot be
      // unwound — record reality instead of stopping the live instance.
      log('⏹ Cancelled just before finalizing — in-place redeploy already applied, live runtime stays up');
      await db.update(services).set({ status: 'running', runtimeId: newRuntimeId }).where(eq(services.id, service.id));
    }
    return;
  }
  const persisted = await db
    .update(services)
    .set({ status: 'running', runtimeId: newRuntimeId, port: runtime!.port ?? null, commitSha: sha })
    .where(eq(services.id, service.id))
    .returning({ id: services.id });
  if (persisted.length === 0) {
    // The service was deleted while this deploy was building. Nothing tracks
    // the candidate any more — retire it so it cannot hold its port forever.
    log('Service row disappeared mid-deploy (deleted) — retiring the orphaned runtime');
    await builder.stop(newRuntimeId).catch(() => undefined);
    return;
  }

  // Auto-provision wildcard domain if configured and not already present.
  // Isolated: a failure here must not affect the already-running container.
  if (config.wildcardDomain) {
    try {
      const wildcardHost = `${service.slug}.${config.wildcardDomain}`;
      const existing = await db.query.domains.findFirst({ where: and(eq(domains.serviceId, service.id), eq(domains.hostname, wildcardHost)) });
      if (!existing) {
        const ssl = !!(await getAcmeEmail(db));
        await db.insert(domains).values({ serviceId: service.id, hostname: wildcardHost, path: '/', ssl, status: 'active' });
        log(`🌐 Auto-assigned URL: ${ssl ? 'https' : 'http'}://${wildcardHost}`);
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
    log('##[stage:PROXY_SWAP:running] Updating Traefik dynamic router & shifting live traffic');
    await writeDynamicConfig(db);
    routingFlipped = true;
    log('##[stage:PROXY_SWAP:success]');
  } catch (err) {
    log(`proxy warning: ${msg(err)}`);
  }
  if (previous && !inPlaceRedeploy) {
    // Only retire the previous container once routing has actually flipped to
    // the new one — otherwise we'd stop the still-serving version and cause an
    // outage. If the config write failed, leave the previous container live.
    // In-place redeploys are excluded above: their "previous" id IS the new
    // live runtime, and stopping it would delete the fresh deployment.
    if (routingFlipped) {
      log('##[stage:CLEANUP:running] Graceful shutdown of old container instance');
      if (buildConfig?.preStopCmd) {
        log(`▶ Running Pre-Stop Hook: ${buildConfig.preStopCmd} …`);
        const currentEnvironment = await loadRuntimeEnv(db, service);
        await runHook(buildConfig.preStopCmd, workDir, currentEnvironment.values, log).catch((err) =>
          log(`pre-stop warning: ${msg(err)}`),
        );
      }
      // Give Traefik's file watcher a moment to apply the new config before
      // retiring the old container — otherwise its reload latency could 502
      // requests still routed to the previous version.
      await sleep(2000);
      await builder
        .stop(previous.runtimeId, { graceSeconds: buildConfig?.stopGraceSeconds })
        .catch((err) => log(`finalize warning (previous stop): ${msg(err)}`));
      log('##[stage:CLEANUP:success]');
    } else {
      log('↩ finalize skipped: routing did not flip, the previous container stays live');
    }
  } else {
    if (inPlaceRedeploy) {
      log('In-place redeploy: the live instance carries the new version — nothing to retire');
    }
    log('##[stage:CLEANUP:success]');
  }
  log('##[stage:COMPLETE:success] Service is live and healthy on production');
  log('✓ Deployment successful');
}
