import fp from 'fastify-plugin';
import { ensureNetwork, ensureTraefik, getAcmeEmail, getDnsConfig, writeDynamicConfig } from '../engine/proxy.js';

/**
 * Ensures the shared Docker network, the Traefik reverse proxy, and the dynamic
 * routing config are ready when the server starts.
 */
export default fp(
  async (fastify) => {
    const healTraefik = async (component: string) => {
      const log = (line: string) => fastify.log.info({ component }, line);
      await ensureNetwork(log);
      await ensureTraefik(
        log,
        await getAcmeEmail(fastify.db).catch(() => null),
        await getDnsConfig(fastify.db).catch(() => null),
      );
    };

    fastify.addHook('onReady', async () => {
      await healTraefik('infra');
      await writeDynamicConfig(fastify.db).catch((err) =>
        fastify.log.error({ err }, 'failed to write traefik dynamic config'),
      );
    });

    // Periodic self-healing watchdog: checks every 5 minutes and revives Traefik if stopped
    const watchdogTimer = setInterval(async () => {
      try {
        await healTraefik('traefik-watchdog');
      } catch (err) {
        fastify.log.warn({ err }, 'traefik watchdog check failed');
      }
    }, 5 * 60 * 1000);
    watchdogTimer.unref();

    fastify.addHook('onClose', async () => {
      clearInterval(watchdogTimer);
    });
  },
  { name: 'ninedeploy-traefik' },
);
