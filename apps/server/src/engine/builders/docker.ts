import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Builder } from '../types.js';
import { capture, run, sleep } from '../../lib/exec.js';
import { NETWORK } from '../proxy.js';

const swallow = () => {};

/**
 * Write runtime env vars to a temp file (mode 0600) for `docker run --env-file`.
 * Passing secrets as a file — instead of `-e KEY=VALUE` argv — keeps them out of
 * `ps` output and `docker inspect` for any local user on the host.
 *
 * Docker reads the file during `docker run`, so it can be deleted once the
 * command returns. Returns null when there is nothing to inject.
 */
function writeEnvFile(env: Record<string, string>): string | null {
  const entries = Object.entries(env);
  if (entries.length === 0) return null;
  const file = path.join(tmpdir(), `nd-env-${process.pid}-${Date.now()}.env`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, entries.map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  return file;
}

/** Whether a container exists and is currently in the `running` state. */
async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const out = await capture('docker', ['inspect', name, '--format', '{{.State.Status}}']);
    return out.trim() === 'running';
  } catch {
    return false;
  }
}

/** Docker builder: BuildKit image build + container run/stop via the docker CLI. */
export const dockerBuilder: Builder = {
  async buildAndRun(ctx) {
    const { service, buildConfig, workDir, deploymentId, commitSha, env, imageDigest, log } = ctx;
    const name = `${service.slug}-${deploymentId}`;

    // Determine the image to run: a pre-built image (template/one-click) or build from source.
    let target: string;
    if (service.image) {
      // On rollback, pin the exact image by digest instead of the mutable tag.
      target = imageDigest ?? service.image;
      log(`Pulling image ${target} …`);
      await run('docker', ['pull', target], {}, log).catch((err) =>
        // Pull may fail if the image is only available locally — surface but tolerate.
        log(`pull warning: ${err instanceof Error ? err.message : String(err)}`),
      );
    } else {
      target = `ninedeploy/${service.slug}:${commitSha.slice(0, 7) || 'latest'}`;
      const baseDir = !buildConfig?.baseDir || buildConfig.baseDir === '/' ? '.' : buildConfig.baseDir;
      const dockerfile = buildConfig?.dockerfilePath || 'Dockerfile';
      log(`Building image ${target} …`);
      await run('docker', ['build', '-t', target, '-f', dockerfile, baseDir], { cwd: workDir, env: { DOCKER_BUILDKIT: '1' } }, log);
    }

    // BLUE-GREEN: the previous container is intentionally NOT stopped here. It
    // keeps serving traffic (Traefik still routes to it by name) until the new
    // container passes its healthcheck. The pipeline stops the previous one
    // (finalize) only after success; on failure it stops the NEW container,
    // leaving the old one running — a zero-downtime rollback.

    const args = ['run', '-d', '--name', name, '--restart', 'unless-stopped', '--network', NETWORK];
    // Bind to loopback only — the container must NOT be reachable on public
    // interfaces. Public traffic enters exclusively through Traefik, which
    // reaches the container by name over the shared network. The loopback
    // binding exists only so the healthcheck can probe it from the host.
    if (service.port) args.push('-p', `127.0.0.1:${service.port}:${service.port}`);
    if (service.cpuShares > 0) args.push('--cpu-shares', String(service.cpuShares));
    if (service.memLimitMb > 0) args.push('--memory', `${service.memLimitMb}m`);
    if (service.volumeMount) args.push('-v', `nd-svc-${service.slug}-data:${service.volumeMount}`);

    const envFile = writeEnvFile(env);
    if (envFile) args.push('--env-file', envFile);
    args.push(target);

    log(`Starting container ${name} …`);
    try {
      await run('docker', args, {}, log);
    } finally {
      if (envFile) {
        try {
          unlinkSync(envFile);
        } catch {
          /* already removed */
        }
      }
    }

    // Capture the resolved image digest so rollback can later pin this exact image.
    let digest: string | undefined;
    try {
      digest = (await capture('docker', ['inspect', name, '--format', '{{.Image}}'])).trim() || undefined;
    } catch {
      /* non-fatal — digest is best-effort */
    }

    return { runtimeId: name, port: service.port ?? null, healthPath: service.healthPath ?? '/', imageDigest: digest };
  },

  async isHealthy(runtime, timeoutMs = 30_000) {
    const healthPath = runtime.healthPath || '/';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // First requirement in every iteration: the container must still be alive.
      // A process that exits seconds after `docker run -d` must not pass.
      if (!(await isContainerRunning(runtime.runtimeId))) {
        await sleep(1000);
        continue;
      }
      if (runtime.port) {
        // Probe the HTTP endpoint with a short per-attempt timeout so a server
        // that accepts TCP but never responds can't stall the whole deadline.
        try {
          const res = await fetch(`http://127.0.0.1:${runtime.port}${healthPath}`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.status < 500) return true;
        } catch {
          /* not up yet — retry until the deadline */
        }
        await sleep(1000);
      } else {
        // No HTTP port to probe — a live container is the strongest signal available.
        return true;
      }
    }
    return false;
  },

  async stop(runtimeId) {
    try {
      await run('docker', ['stop', '-t', '5', runtimeId], {}, swallow);
    } catch {
      /* already gone */
    }
    try {
      await run('docker', ['rm', '-f', runtimeId], {}, swallow);
    } catch {
      /* already gone */
    }
  },
};
