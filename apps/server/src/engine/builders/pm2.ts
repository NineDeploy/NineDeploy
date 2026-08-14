import { readFileSync } from 'node:fs';
import type { ProcessDescription } from 'pm2';
import pm2 from 'pm2';
import type { Builder } from '../types.js';
import { run, sleep } from '../../lib/exec.js';

const connect = () => new Promise<void>((res, rej) => pm2.connect((err) => (err ? rej(err) : res())));

/** Run `fn` against the PM2 daemon, always disconnecting afterwards. */
const withPm2 = async <T>(fn: () => Promise<T>): Promise<T> => {
  await connect();
  try {
    return await fn();
  } finally {
    pm2.disconnect();
  }
};

/**
 * Split a start command into a PM2 script + args. PM2's `script` option is a
 * binary/file path, not a shell command — so `node dist/index.js` must become
 * `script: 'node', args: 'dist/index.js'`, and `npm start` must become
 * `script: 'npm', args: 'start'`. Without this, PM2 treats the whole string as
 * a (non-existent) script path.
 */
function parseStartCommand(cmd: string): { script: string; args: string } {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { script: 'npm', args: 'start' };
  return { script: parts[0]!, args: parts.slice(1).join(' ') };
}

/** PM2 builder: install + build, then run/stop the app via the PM2 daemon. */
export const pm2Builder: Builder = {
  async buildAndRun(ctx, previous) {
    const { service, buildConfig, workDir, deploymentId, env, log } = ctx;

    // Build steps run WITH the service env so they can see DB connection
    // strings and other config the app needs at build time.
    if (buildConfig?.installCmd) {
      log('Installing dependencies …');
      await run('sh', ['-c', buildConfig.installCmd], { cwd: workDir, env }, log);
    }
    if (buildConfig?.buildCmd) {
      log('Building …');
      await run('sh', ['-c', buildConfig.buildCmd], { cwd: workDir, env }, log);
    }
    // PM2 binds the service port, so two versions cannot coexist — the previous
    // process must stop before the new one starts. True zero-downtime is only
    // achievable by the Docker builder (blue-green); PM2 accepts a brief gap,
    // and the pipeline cleans up a failed new process on error.
    if (previous) {
      log(`Stopping previous process ${previous.runtimeId} …`);
      await this.stop(previous.runtimeId);
    }

    const name = `${service.slug}-${deploymentId}`;
    const { script, args } = parseStartCommand(buildConfig?.startCmd ?? '');
    log(`Starting PM2 process ${name} …`);

    // interpreter: 'none' makes PM2 exec the script directly so `npm`/`node`
    // are run as binaries instead of being re-interpreted through node.
    const startOpts: Record<string, unknown> = {
      name,
      script,
      args,
      interpreter: 'none',
      cwd: workDir,
      autorestart: true,
      max_restarts: 10,
      env,
    };
    // Enforce a memory ceiling via PM2's auto-restart-on-OOM, mirroring the
    // Docker builder's --memory limit.
    if (service.memLimitMb > 0) startOpts.max_memory_restart = `${service.memLimitMb}M`;

    await withPm2(
      () =>
        new Promise<void>((res, rej) =>
          pm2.start(startOpts, (err) => (err ? rej(err) : res())),
        ),
    );
    return { runtimeId: name, port: service.port ?? null, healthPath: service.healthPath ?? '/' };
  },

  async isHealthy(runtime, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const online = await withPm2(async () => {
        const procs = await new Promise<ProcessDescription[]>((res, rej) =>
          pm2.describe(runtime.runtimeId, (err, desc) => (err ? rej(err) : res(desc ?? []))),
        );
        return procs.some((proc) => proc?.pm2_env?.status === 'online');
      }).catch(() => false);
      if (online) return true;
      await sleep(1000);
    }
    return false;
  },

  async stop(runtimeId) {
    await withPm2(() => new Promise<void>((res) => pm2.delete(runtimeId, () => res()))).catch(
      () => undefined,
    );
  },
};

/**
 * Stop a PM2 process (keeps it registered; status → stopped). Unlike the
 * deploy-engine teardown above (`stop` deletes the process), lifecycle stop
 * preserves the process so `start` can resume it without a full redeploy.
 */
export async function pm2Stop(runtimeId: string): Promise<void> {
  await withPm2(() => new Promise<void>((res, rej) => pm2.stop(runtimeId, (err) => (err ? rej(err) : res()))));
}

/** Start (resume) an existing PM2 process. Rejects when it was deleted. */
export async function pm2Start(runtimeId: string): Promise<void> {
  await withPm2(() => new Promise<void>((res, rej) => pm2.restart(runtimeId, (err) => (err ? rej(err) : res()))));
}

/** Restart a PM2 process. */
export async function pm2Restart(runtimeId: string): Promise<void> {
  await withPm2(() => new Promise<void>((res, rej) => pm2.restart(runtimeId, (err) => (err ? rej(err) : res()))));
}

/** Tail the last 300 lines of a process's combined stdout+stderr log files. */
export async function pm2Logs(runtimeId: string): Promise<string> {
  return withPm2(async () => {
    const procs = await new Promise<ProcessDescription[]>((res, rej) =>
      pm2.describe(runtimeId, (err, desc) => (err ? rej(err) : res(desc ?? []))),
    );
    const proc = procs.find((p) => p?.name === runtimeId);
    const tail = (file: string | undefined): string => {
      if (!file) return '';
      try {
        const lines = readFileSync(file, 'utf8').split('\n');
        // A trailing newline yields a final empty element — drop it so joined
        // out+err logs don't end in a stray blank line.
        if (lines[lines.length - 1] === '') lines.pop();
        return lines.slice(-300).join('\n');
      } catch {
        return '';
      }
    };
    return [tail(proc?.pm2_env?.pm_out_log_path), tail(proc?.pm2_env?.pm_err_log_path)].filter(Boolean).join('\n');
  });
}
