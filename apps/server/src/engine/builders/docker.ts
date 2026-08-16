import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Builder } from '../types.js';
import type { BuildConfig } from '@ninedeploy/db';
import { capture, buildEnv, run, sleep } from '../../lib/exec.js';
import { NETWORK } from '../proxy.js';

const swallow = () => {};

/** Valid docker --restart values: the fixed policies plus on-failure:N. */
const RE_RESTART = /^(no|always|unless-stopped|on-failure(?::\d{1,3})?)$/;
const safeRestartPolicy = (raw: string | undefined): string =>
  raw && RE_RESTART.test(raw) ? raw : 'unless-stopped';

/**
 * Write runtime env vars to a temp file (mode 0600) which docker then loads
 * via its env-file option. Keeping secrets in a file — rather than on the
 * command line — keeps them out of process listings and container inspection.
 */
function writeEnvFile(env: Record<string, string>): string | null {
  const entries = Object.entries(env);
  if (entries.length === 0) return null;
  const file = path.join(tmpdir(), `nd-env-${process.pid}-${Date.now()}.env`);
  mkdirSync(path.dirname(file), { recursive: true });
  const body = entries.map(([k, v]) => [k, v].join('=')).join('\n');
  writeFileSync(file, `${body}\n`, { mode: 0o600 });
  return file;
}

/** Shared no-op sinks (EPIPE guards / best-effort log drains). */
const swallowLine = (line: string): void => void line;
const swallowErr = (): void => undefined;

/**
 * Resolve a container's IP address on the shared Docker network, or null when
 * the container is not running. The host can route to bridge-network IPs
 * directly, which lets us healthcheck a container WITHOUT publishing any host
 * port — so blue-green never fights over `127.0.0.1:<port>` and rollback probes
 * always resolve the current address fresh from the runtime id.
 */
export async function containerIp(name: string): Promise<string | null> {
  try {
    const out = await capture('docker', [
      'inspect', name,
      '--format', '{{.State.Status}}|{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    ]);
    const [status, ip] = out.trim().split('|');
    return status === 'running' && ip ? ip : null;
  } catch {
    return null;
  }
}

/**
 * Build a source dir into a Docker image with Nixpacks — the buildpack path
 * for repos that ship no Dockerfile (e.g. a plain Next.js app). install/build/
 * start commands from the build config override Nixpacks' own detection, so
 * `npm ci` / `npm run build` / `npm start` style customizations work the same
 * way they do on Dokploy/Coolify.
 */
async function buildWithNixpacks(
  target: string,
  baseDir: string,
  buildConfig: BuildConfig | undefined,
  workDir: string,
  log: (line: string) => void,
): Promise<void> {
  // Fail fast with a actionable message rather than a bare ENOENT when the
  // host never installed the CLI.
  try {
    await capture('nixpacks', ['--version']);
  } catch {
    throw new Error(
      'nixpacks is not installed on this server — install it (curl -sSL https://nixpacks.com/install.sh | bash) or add a Dockerfile to the repo',
    );
  }
  const args = ['build', baseDir, '--name', target];
  if (buildConfig?.installCmd) args.push('--install-cmd', buildConfig.installCmd);
  if (buildConfig?.buildCmd) args.push('--build-cmd', buildConfig.buildCmd);
  if (buildConfig?.startCmd) args.push('--start-cmd', buildConfig.startCmd);
  log(`nixpacks build ${baseDir} …`);
  await run('nixpacks', args, { cwd: workDir }, log);
}

/** Docker builder: BuildKit image build + container run/stop via the docker CLI. */
export const dockerBuilder: Builder = {
  async buildAndRun(ctx, previous) {
    const { service, buildConfig, workDir, deploymentId, commitSha, env, imageDigest, registryAuth, log } = ctx;
    const name = `${service.slug}-${deploymentId}`;
    void previous;

    // Private registry: docker login (password via stdin, never argv) before
    // pulling, logout afterwards so the credential never lingers.
    const server = registryAuth?.server ?? '';
    let loggedIn = false;
    if (registryAuth) {
      const loginArgs = ['login', '--username', registryAuth.username, '--password-stdin'];
      if (server) loginArgs.push(server);
      log(`Authenticating to registry ${server || '(default)'} …`);
      const { spawn } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        // Isolated env (same allowlist as every other exec) so host secrets
        // like the master key never leak into the login child.
        const child = spawn('docker', loginArgs, { env: buildEnv() });
        const swallow = swallowErr; // child gone / EPIPE on stdin
        child.stdin.on('error', swallow);
        child.stdin.write(`${registryAuth.password}\n`);
        child.stdin.end();
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`docker login failed with exit code ${code}`))));
        child.on('error', reject);
      });
      loggedIn = true;
    }

    // Determine the image to run: a pre-built image (template/one-click) or build from source.
    let target: string;
    try {
    if (service.image) {
      // On rollback, pin the exact image by digest instead of the mutable tag.
      target = imageDigest ?? service.image;
      log(`Pulling image ${target} …`);
      try {
        await run('docker', ['pull', target], {}, log);
      } catch (pullErr) {
        // A failed pull is only tolerable when the image exists locally
        // (local-only images). Otherwise a stale tag must NOT silently deploy
        // old code — and a missing image can never start anyway.
        let local = false;
        try {
          await capture('docker', ['image', 'inspect', target, '--format', '{{.Id}}']);
          local = true;
        } catch {
          local = false;
        }
        if (!local) throw pullErr;
        log(`pull failed, using local image ${target} (${pullErr instanceof Error ? pullErr.message : String(pullErr)})`);
      }
    } else {
      target = `ninedeploy/${service.slug}:${commitSha.slice(0, 7) || 'latest'}`;
      const baseDir = !buildConfig?.baseDir || buildConfig.baseDir === '/' ? '.' : buildConfig.baseDir;
      const dockerfile = buildConfig?.dockerfilePath || 'Dockerfile';
      const pack = buildConfig?.buildPack ?? 'auto';
      // 'auto' resolves per-repo: an existing Dockerfile wins, otherwise fall
      // through to Nixpacks so Dockerfile-less repos (plain Next.js etc.) build
      // without any repo-side changes.
      const hasDockerfile = existsSync(path.resolve(workDir, baseDir, dockerfile));
      const useNixpacks = pack === 'nixpacks' || (pack === 'auto' && !hasDockerfile);
      log(`Building image ${target} …`);
      if (useNixpacks) {
        await buildWithNixpacks(target, baseDir, buildConfig, workDir, log);
        // Buildpack apps conventionally listen on $PORT — align it with the
        // declared service port so Traefik routing matches without extra config.
        if (service.port && env.PORT === undefined) env.PORT = String(service.port);
      } else {
        await run('docker', ['build', '-t', target, '-f', dockerfile, baseDir], { cwd: workDir, env: { DOCKER_BUILDKIT: '1' } }, log);
      }
    }
    } finally {
      if (loggedIn) {
        const logoutArgs = ['logout', ...(server ? [server] : [])];
        try {
          await run('docker', logoutArgs, {}, swallowLine);
        } catch {
          /* best-effort logout */
        }
      }
    }

    // BLUE-GREEN: the previous container is intentionally NOT stopped here. It
    // keeps serving traffic (Traefik still routes to it by name) until the new
    // container passes its healthcheck. The pipeline stops the previous one
    // (finalize) only after success; on failure it stops the NEW container,
    // leaving the old one running — a zero-downtime rollback.

    const args = ['run', '-d', '--name', name, '--restart', safeRestartPolicy(buildConfig?.restartPolicy), '--network', NETWORK];
    // NOTE: no `-p` host port is published at all. Public traffic enters
    // exclusively through Traefik, which reaches the container by name over the
    // shared network; healthchecks probe the container's network IP directly
    // (see isHealthy). This keeps blue-green conflict-free — two versions can
    // run side by side without fighting over a host port — and removes the
    // loopback exposure entirely.
    if (service.cpuShares > 0) args.push('--cpu-shares', String(service.cpuShares));
    if (service.memLimitMb > 0) args.push('--memory', `${service.memLimitMb}m`);
    if (service.volumeMount) args.push('-v', `nd-svc-${service.slug}-data:${service.volumeMount}`);
    // Template-only flag (registry is admin-controlled): expose Docker control.
    if (service.dockerSocket) args.push('-v', '/var/run/docker.sock:/var/run/docker.sock');

    const envFile = writeEnvFile(env);
    if (envFile) args.push('--env-file', envFile);
    args.push(target);
    // Template-defined command (argv after the image) — e.g. minio needs
    // `server /data` because its bare entrypoint just prints help and exits.
    if (service.cmd?.length) args.push(...service.cmd);

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

  // 5-minute deadline: first boots (model downloads, DB migrations) are slow.
  async isHealthy(runtime, timeoutMs = 300_000, directGraceMs = 10_000, log: (line: string) => void = () => undefined) {
    const healthPath = runtime.healthPath || '/';
    const deadline = Date.now() + timeoutMs;
    // Direct host→container-IP probing works on Linux bridges but NOT on
    // Docker Desktop (macOS/Windows), where container IPs are unreachable
    // from the host. After a grace period of failed direct probes, fall back
    // to probing from a throwaway sibling container on the shared network —
    // name-based DNS works everywhere the app itself will be reached.
    const start = Date.now();
    let usedSiblingProbe = false;
    while (Date.now() < deadline) {
      // Resolve the container's network address fresh on every attempt: null
      // when it is not running (a process that exits right after `docker run -d`
      // must not pass), and always the CURRENT address — which is exactly what
      // makes blue-green and rollback probes correct without persisting ports.
      const ip = await containerIp(runtime.runtimeId);
      if (!ip) {
        await sleep(1000);
        continue;
      }
      if (runtime.port) {
        if (Date.now() - start < directGraceMs) {
          // Probe the HTTP endpoint with a short per-attempt timeout so a server
          // that accepts TCP but never responds can't stall the whole deadline.
          try {
            const res = await fetch(`http://${ip}:${runtime.port}${healthPath}`, {
              signal: AbortSignal.timeout(3000),
            });
            // Always drain/cancel the body so the undici connection is released
            // instead of leaking one socket per probe iteration.
            try {
              await res.body?.cancel();
            } catch {
              /* body already consumed */
            }
            if (res.status < 500) return true;
          } catch {
            /* not up yet — retry until the grace period ends */
          }
          await sleep(1000);
          continue;
        }
        // Sibling probe: a raw TCP connect from the shared network. We probe
        // by the INSPECTED IP (container names can wildcard-resolve through
        // Docker Desktop's upstream DNS) and at the TCP level rather than
        // HTTP: busybox wget FOLLOWS redirects, and relative redirects from
        // apps like Jellyfin (Location: web/) then resolve as hostnames.
        // "Is the port accepting connections inside the network" is exactly
        // the signal this fallback needs.
        try {
          await run('docker', [
            'run', '--rm', '--network', NETWORK,
            'busybox:1.36', 'nc', '-w', '3', ip, String(runtime.port),
          ], {}, log);
          return true;
        } catch (probeErr) {
          usedSiblingProbe = true;
          // Surface WHY the sibling probe failed — healthcheck debugging
          // otherwise degrades to a bare "did not become ready".
          log(`sibling probe failed: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`);
        }
        await sleep(3000);
      } else {
        // No HTTP port to probe — a live container is the strongest signal available.
        return true;
      }
    }
    void usedSiblingProbe;
    return false;
  },

  async stop(runtimeId, opts) {
    const grace = opts?.graceSeconds && opts.graceSeconds >= 0 ? Math.min(Math.floor(opts.graceSeconds), 300) : 5;
    try {
      await run('docker', ['stop', '-t', String(grace), runtimeId], {}, swallow);
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
