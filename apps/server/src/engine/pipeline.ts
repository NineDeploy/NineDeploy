import path from 'node:path';
import { eq } from 'drizzle-orm';
import { buildConfigs, databaseAttachments, databases, type DB, deployments, envVars, services, sources } from '@ninedeploy/db';
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

async function fail(db: DB, deploymentId: number, serviceId: number): Promise<void> {
  await db
    .update(deployments)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(eq(deployments.id, deploymentId));
  await db.update(services).set({ status: 'error' }).where(eq(services.id, serviceId));
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
    await fail(db, deploymentId, service.id);
    return;
  }

  const workDir = path.join(config.paths.reposDir, String(service.id));
  let runtime: DeployRuntime | undefined;
  try {
    // Image-based deploys skip git entirely; repo-based deploys resolve creds + checkout.
    let sha = '';
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

    const previous: DeployRuntime | undefined = service.runtimeId
      ? { runtimeId: service.runtimeId, port: service.port ?? null, healthPath: service.healthPath ?? '/' }
      : undefined;

    const ctx: BuildContext = {
      deploymentId,
      service,
      buildConfig: buildConfig ?? undefined,
      workDir,
      commitSha: sha,
      env: await loadRuntimeEnv(db, service.id),
      log,
    };
    runtime = await builder.buildAndRun(ctx, previous);

    log('Running healthcheck …');
    const healthy = await builder.isHealthy(runtime);
    if (!healthy) throw new Error('Healthcheck failed — service did not become ready in time');

    await db
      .update(services)
      .set({ status: 'running', runtimeId: runtime.runtimeId, port: runtime.port ?? null, commitSha: sha })
      .where(eq(services.id, service.id));
    await db
      .update(deployments)
      .set({ status: 'running', finishedAt: new Date() })
      .where(eq(deployments.id, deploymentId));
    // Refresh Traefik routing so any attached domains point at the new runtime.
    await writeDynamicConfig(db).catch((err) => log(`proxy warning: ${err instanceof Error ? err.message : err}`));
    log('✓ Deployment successful');
  } catch (err) {
    log(`✗ Deployment failed: ${err instanceof Error ? err.message : String(err)}`);
    if (runtime) await builder.stop(runtime.runtimeId).catch(() => undefined);
    await fail(db, deploymentId, service.id);
  }
}
