import type { Builder } from '../types.js';
import { run, sleep } from '../../lib/exec.js';
import { NETWORK } from '../proxy.js';

const swallow = () => {};

/** Docker builder: BuildKit image build + container run/stop via the docker CLI. */
export const dockerBuilder: Builder = {
  async buildAndRun(ctx, previous) {
    const { service, buildConfig, workDir, deploymentId, commitSha, log } = ctx;
    const name = `${service.slug}-${deploymentId}`;

    // Determine the image to run: a pre-built image (template/one-click) or build from source.
    let target: string;
    if (service.image) {
      target = service.image;
      log(`Pulling image ${target} …`);
      await run('docker', ['pull', target], {}, log).catch(() => undefined);
    } else {
      target = `ninedeploy/${service.slug}:${commitSha.slice(0, 7) || 'latest'}`;
      const baseDir = !buildConfig?.baseDir || buildConfig.baseDir === '/' ? '.' : buildConfig.baseDir;
      const dockerfile = buildConfig?.dockerfilePath || 'Dockerfile';
      log(`Building image ${target} …`);
      await run('docker', ['build', '-t', target, '-f', dockerfile, baseDir], { cwd: workDir, env: { DOCKER_BUILDKIT: '1' } }, log);
    }

    if (previous) {
      log(`Stopping previous container ${previous.runtimeId} …`);
      await this.stop(previous.runtimeId);
    }

    const args = ['run', '-d', '--name', name, '--restart', 'unless-stopped', '--network', NETWORK];
    // Bind to loopback only — the container must NOT be reachable on public
    // interfaces. Public traffic enters exclusively through Traefik, which
    // reaches the container by name over the shared network. The loopback
    // binding exists only so the healthcheck can probe it from the host.
    if (service.port) args.push('-p', `127.0.0.1:${service.port}:${service.port}`);
    if (service.cpuShares > 0) args.push('--cpu-shares', String(service.cpuShares));
    if (service.memLimitMb > 0) args.push('--memory', `${service.memLimitMb}m`);
    if (service.volumeMount) args.push('-v', `nd-svc-${service.slug}-data:${service.volumeMount}`);
    for (const [k, v] of Object.entries(ctx.env)) args.push('-e', `${k}=${v}`);
    args.push(target);

    log(`Starting container ${name} …`);
    await run('docker', args, {}, log);
    return { runtimeId: name, port: service.port ?? null };
  },

  async isHealthy(runtime, timeoutMs = 30_000) {
    if (!runtime.port) return true; // nothing to probe
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${runtime.port}/`);
        if (res.status < 500) return true;
      } catch {
        /* not up yet */
      }
      await sleep(1000);
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
