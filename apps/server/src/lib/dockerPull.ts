import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capture, run, sleep } from './exec.js';

const SNAPSHOT_FAILURE = /extraction snapshot|target snapshot .*already exists|parent snapshot .*does not exist/i;
const STALE_EXISTING_SNAPSHOT = /target snapshot .*already exists/i;

/** Docker/containerd snapshot errors known to be transient on Docker 29+. */
export function isTransientSnapshotFailure(lines: readonly string[]): boolean {
  return SNAPSHOT_FAILURE.test(lines.join('\n'));
}

type Descriptor = {
  digest?: string;
  Digest?: string;
  platform?: { architecture?: string; os?: string };
  Platform?: { Architecture?: string; OS?: string };
};

type ImageConfig = {
  config?: {
    Env?: string[];
    Entrypoint?: string[] | null;
    Cmd?: string[] | null;
    WorkingDir?: string;
    User?: string;
    StopSignal?: string;
    ExposedPorts?: Record<string, unknown>;
    Volumes?: Record<string, unknown>;
    Labels?: Record<string, string>;
    OnBuild?: string[] | null;
    Healthcheck?: {
      Test?: string[];
      Interval?: number;
      Timeout?: number;
      StartPeriod?: number;
      StartInterval?: number;
      Retries?: number;
    };
  };
};

function descriptorDigest(value: Descriptor | undefined): string | undefined {
  return value?.digest ?? value?.Digest;
}

/** ctr requires a fully-qualified Docker Hub reference. */
export function normalizeContainerdImageRef(image: string): string {
  const name = image.split('@')[0]!;
  if (!name.includes('/')) return `docker.io/library/${image}`;
  const first = name.split('/')[0]!;
  if (first.includes('.') || first.includes(':') || first === 'localhost') return image;
  return `docker.io/${image}`;
}

function hostArchitecture(): string {
  if (process.arch === 'x64') return 'amd64';
  if (process.arch === 'arm64') return 'arm64';
  return process.arch;
}

async function readContainerdImageConfig(ref: string): Promise<ImageConfig> {
  const info = JSON.parse(await capture('ctr', ['--namespace', 'moby', 'images', 'info', ref])) as {
    target?: Descriptor;
    Target?: Descriptor;
  };
  let digest = descriptorDigest(info.target ?? info.Target);
  if (!digest) throw new Error('containerd image has no target digest');

  let manifest = JSON.parse(await capture('ctr', ['--namespace', 'moby', 'content', 'get', digest])) as {
    manifests?: Descriptor[];
    config?: Descriptor;
  };
  if (manifest.manifests) {
    const arch = hostArchitecture();
    const selected = manifest.manifests.find((entry) => {
      const platform = entry.platform ?? (entry.Platform ? { architecture: entry.Platform.Architecture, os: entry.Platform.OS } : undefined);
      return platform?.os === 'linux' && platform.architecture === arch;
    });
    digest = descriptorDigest(selected);
    if (!digest) throw new Error(`containerd image has no linux/${arch} manifest`);
    manifest = JSON.parse(await capture('ctr', ['--namespace', 'moby', 'content', 'get', digest])) as {
      manifests?: Descriptor[];
      config?: Descriptor;
    };
  }

  const configDigest = descriptorDigest(manifest.config);
  if (!configDigest) throw new Error('containerd image manifest has no config digest');
  return JSON.parse(await capture('ctr', ['--namespace', 'moby', 'content', 'get', configDigest])) as ImageConfig;
}

function importChanges(imageConfig: ImageConfig): string[] {
  const cfg = imageConfig.config ?? {};
  const changes: string[] = [];
  for (const entry of cfg.Env ?? []) {
    const separator = entry.indexOf('=');
    changes.push(separator < 0 ? `ENV ${entry}` : `ENV ${entry.slice(0, separator)}=${JSON.stringify(entry.slice(separator + 1))}`);
  }
  if (cfg.Entrypoint) changes.push(`ENTRYPOINT ${JSON.stringify(cfg.Entrypoint)}`);
  if (cfg.Cmd) changes.push(`CMD ${JSON.stringify(cfg.Cmd)}`);
  if (cfg.WorkingDir) changes.push(`WORKDIR ${cfg.WorkingDir}`);
  if (cfg.User) changes.push(`USER ${cfg.User}`);
  if (cfg.StopSignal) changes.push(`STOPSIGNAL ${cfg.StopSignal}`);
  for (const port of Object.keys(cfg.ExposedPorts ?? {})) changes.push(`EXPOSE ${port}`);
  for (const volume of Object.keys(cfg.Volumes ?? {})) changes.push(`VOLUME ${JSON.stringify([volume])}`);
  for (const [key, value] of Object.entries(cfg.Labels ?? {})) changes.push(`LABEL ${key}=${JSON.stringify(value)}`);
  for (const command of cfg.OnBuild ?? []) changes.push(`ONBUILD ${command}`);
  const healthcheck = cfg.Healthcheck;
  if (healthcheck?.Test?.[0] === 'NONE') {
    changes.push('HEALTHCHECK NONE');
  } else if (healthcheck?.Test?.length) {
    const options = [
      healthcheck.Interval && healthcheck.Interval > 0 ? `--interval=${healthcheck.Interval}ns` : undefined,
      healthcheck.Timeout && healthcheck.Timeout > 0 ? `--timeout=${healthcheck.Timeout}ns` : undefined,
      healthcheck.StartPeriod && healthcheck.StartPeriod > 0 ? `--start-period=${healthcheck.StartPeriod}ns` : undefined,
      healthcheck.StartInterval && healthcheck.StartInterval > 0 ? `--start-interval=${healthcheck.StartInterval}ns` : undefined,
      healthcheck.Retries && healthcheck.Retries > 0 ? `--retries=${healthcheck.Retries}` : undefined,
    ].filter(Boolean).join(' ');
    const [kind, ...command] = healthcheck.Test;
    const body = kind === 'CMD' ? `CMD ${JSON.stringify(command)}` : `CMD ${command.join(' ')}`;
    changes.push(`HEALTHCHECK${options ? ` ${options}` : ''} ${body}`);
  }
  return changes.flatMap((change) => ['--change', change]);
}

/**
 * Recover an image without touching the corrupt overlayfs snapshot. containerd
 * verifies and unpacks the original image in its independent `native` store;
 * the resulting rootfs is imported as one new Docker layer while preserving
 * the OCI runtime configuration. Existing images, containers and volumes are
 * never removed or hidden.
 */
export async function recoverImageWithNativeSnapshotter(image: string, log: (line: string) => void): Promise<void> {
  const ref = normalizeContainerdImageRef(image);
  const staging = mkdtempSync(path.join(tmpdir(), 'ninedeploy-image-recovery-'));
  const rootfs = path.join(staging, 'rootfs');
  const archive = path.join(staging, 'rootfs.tar');
  let mounted = false;
  try {
    mkdirSync(rootfs);
    log(`Docker overlayfs snapshot is stale; recovering ${image} through containerd's isolated native snapshotter …`);
    await run('ctr', ['--namespace', 'moby', 'images', 'pull', '--snapshotter', 'native', ref], { timeoutMs: 30 * 60 * 1000 }, log);
    const config = await readContainerdImageConfig(ref);
    await run('ctr', ['--namespace', 'moby', 'images', 'mount', '--snapshotter', 'native', ref, rootfs], {}, log);
    mounted = true;
    await run('tar', ['--acls', '--xattrs', '--numeric-owner', '-C', rootfs, '-cf', archive, '.'], { timeoutMs: 30 * 60 * 1000 }, log);
    await run(
      'docker',
      ['image', 'import', `--platform=linux/${hostArchitecture()}`, ...importChanges(config), archive, image],
      { timeoutMs: 30 * 60 * 1000 },
      log,
    );
    await capture('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
    log(`Recovered ${image} as a verified single-layer image; existing Docker state was preserved`);
  } finally {
    if (mounted) {
      try {
        await run('ctr', ['--namespace', 'moby', 'images', 'unmount', rootfs], {}, () => {});
        mounted = false;
      } catch (error) {
        // Never recurse into a path that might still be a mounted image rootfs.
        log(`Could not unmount recovery rootfs ${rootfs}; leaving it intact for safe manual cleanup: ${String(error)}`);
      }
    }
    if (!mounted) rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Pull an image with bounded recovery for containerd snapshot extraction
 * races. Other failures (auth, missing image, disk full, network policy) fail
 * immediately so retries never hide an actionable root cause.
 */
export async function pullDockerImage(
  image: string,
  log: (line: string) => void,
  maxAttempts = 3,
): Promise<void> {
  let snapshotError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const lines: string[] = [];
    const sink = (line: string) => {
      lines.push(line);
      log(line);
    };
    try {
      await run('docker', ['pull', image], {}, sink);
      return;
    } catch (err) {
      if (!isTransientSnapshotFailure(lines)) throw err;
      snapshotError = err;
      // An existing target with the same immutable chain ID is persistent
      // metadata corruption, not a timing race. Repeating the identical pull
      // cannot repair it, so switch to the isolated snapshotter immediately.
      if (STALE_EXISTING_SNAPSHOT.test(lines.join('\n')) || attempt === maxAttempts) break;
      log(`Docker snapshot extraction race while pulling ${image}; retrying (${attempt + 1}/${maxAttempts})…`);
      await sleep(attempt * 2000);
    }
  }
  try {
    await recoverImageWithNativeSnapshotter(image, log);
  } catch (recoveryError) {
    log(`Native snapshot recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
    throw snapshotError;
  }
}
