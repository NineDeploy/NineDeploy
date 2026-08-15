import { buildApp } from './app.js';
import { config } from './config.js';
import { notifyReady, startWatchdog } from './lib/sdNotify.js';

async function main(): Promise<void> {
  const app = await buildApp();

  app.addHook('onClose', async () => {
    app.log.info('NineDeploy shutting down');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`NineDeploy API listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // systemd integration (no-op without NOTIFY_SOCKET): announce readiness and
  // keep the watchdog fed so a hung event loop is restarted automatically.
  notifyReady();
  const stopWatchdog = startWatchdog(30_000);

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'received signal, closing');
    stopWatchdog();
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
