import { unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Builder, DeployRuntime } from '../types.js';
import { capture, run } from '../../lib/exec.js';
import { repoRelative } from '../../lib/repoPath.js';

const DEPLOY_HEARTBEAT_MS = 20_000;

/**
 * Docker Compose builder: `docker compose up -d --build` for multi-container
 * apps. Unlike the docker builder there is NO blue-green — compose replaces
 * the project in place (brief gap, like PM2). Rollback re-checks out the old
 * commit and re-ups. The compose file is `dockerfilePath` from the build
 * config (default docker-compose.yml); `composeService` names the main
 * service for routing/healthchecks.
 */

const PROJECT_PREFIX = 'ndcmp';

function composeProject(slug: string): string {
  return `${PROJECT_PREFIX}-${slug}`;
}

/** The default container name docker compose assigns: <project>-<service>-1. */
function mainContainer(slug: string, composeService: string): string {
  return `${composeProject(slug)}-${composeService}-1`;
}

export const composeBuilder: Builder = {
  async buildAndRun(ctx): Promise<DeployRuntime> {
    const { service, buildConfig, workDir, env, log } = ctx;
    const composeService = service.composeService ?? service.slug;
    // Same re-anchoring as the docker builder: `-f` runs with cwd=workDir, so
    // an absolute or climbing path would read a compose file off the host.
    const composeFile = repoRelative(workDir, buildConfig?.dockerfilePath || 'docker-compose.yml');
    const project = composeProject(service.slug);

    log(`Bringing up compose project ${project} (${composeFile}) …`);

    // Stop the previous project revision first — no blue-green for compose.
    // Always pass -f: with a non-default compose file, plain `down` would look
    // at docker-compose.yml and miss the real project.
    await run(
      'docker',
      ['compose', '-p', project, '-f', composeFile, 'down', '--remove-orphans'],
      { cwd: workDir, heartbeatMs: DEPLOY_HEARTBEAT_MS, heartbeatLabel: `Stopping previous Compose project ${project}` },
      log,
    ).catch(() => undefined);

    const args = ['compose', '-p', project, '-f', composeFile, 'up', '-d', '--build', '--remove-orphans'];
    // Compose reads project env vars from the working directory's .env — we
    // write one temporarily so services see runtime secrets.
    const dotEnv = path.join(workDir, '.env');
    if (Object.keys(env).length > 0) {
      writeFileSync(dotEnv, `${Object.entries(env).map(([k, v]) => `${k}=${v.replace(/\n/g, '\\n')}`).join('\n')}\n`, { mode: 0o600 });
    }
    try {
      await run(
        'docker',
        args,
        { cwd: workDir, heartbeatMs: DEPLOY_HEARTBEAT_MS, heartbeatLabel: `Starting Compose project ${project}` },
        log,
      );
    } finally {
      try {
        unlinkSync(dotEnv);
      } catch {
        /* no .env written */
      }
    }

    const runtimeId = mainContainer(service.slug, composeService);
    return {
      runtimeId,
      port: service.port ?? null,
      healthPath: service.healthPath || '/',
      imageDigest: undefined, // multi-container: digest pinning is per-service
    };
  },

  async isHealthy(runtime, timeoutMs = 60_000, _directGraceMs, log): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const out = await capture('docker', ['inspect', runtime.runtimeId, '--format', '{{.State.Status}}']);
        if (out.trim() === 'running') return true;
      } catch {
        /* container not up yet */
      }
      log?.(`waiting for ${runtime.runtimeId} …`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  },

  async stop(runtimeId): Promise<void> {
    // runtimeId is <project>-<service>-1, but both project (ndcmp-<slug>) and
    // service names contain hyphens, so the project cannot be recovered by
    // string surgery. Ask the container itself via compose's own labels —
    // that also yields the config file so `down` targets the right project.
    try {
      const labels = await capture('docker', [
        'inspect',
        runtimeId,
        '--format',
        '{{ index .Config.Labels "com.docker.compose.project" }}\t{{ index .Config.Labels "com.docker.compose.project.config_files" }}',
      ]);
      const [project, configFiles] = labels.trim().split('\t');
      if (!project) throw new Error('no compose project label');
      const args = ['compose', '-p', project];
      if (configFiles) for (const f of configFiles.split(',')) args.push('-f', f.trim());
      args.push('down', '--remove-orphans');
      await run('docker', args, {}, () => {});
    } catch {
      // Container already gone — nothing to stop.
    }
  },
};
