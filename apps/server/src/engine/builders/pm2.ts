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

/** PM2 builder: install + build, then run/stop the app via the PM2 daemon. */
export const pm2Builder: Builder = {
  async buildAndRun(ctx, previous) {
    const { service, buildConfig, workDir, deploymentId, log } = ctx;

    if (buildConfig?.installCmd) {
      log('Installing dependencies …');
      await run('sh', ['-c', buildConfig.installCmd], { cwd: workDir }, log);
    }
    if (buildConfig?.buildCmd) {
      log('Building …');
      await run('sh', ['-c', buildConfig.buildCmd], { cwd: workDir }, log);
    }
    if (previous) {
      log(`Stopping previous process ${previous.runtimeId} …`);
      await this.stop(previous.runtimeId);
    }

    const name = `${service.slug}-${deploymentId}`;
    log(`Starting PM2 process ${name} …`);
    await withPm2(
      () =>
        new Promise<void>((res, rej) =>
          pm2.start(
            {
              name,
              script: buildConfig?.startCmd || 'npm start',
              cwd: workDir,
              autorestart: true,
              max_restarts: 10,
              env: ctx.env,
            },
            (err) => (err ? rej(err) : res()),
          ),
        ),
    );
    return { runtimeId: name, port: service.port ?? null };
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
