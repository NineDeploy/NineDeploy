import fp from 'fastify-plugin';
import { ensureNetwork, ensureTraefik, getAcmeEmail, writeDynamicConfig } from '../engine/proxy.js';

/**
 * Ensures the shared Docker network, the Traefik reverse proxy, and the dynamic
 * routing config are ready when the server starts.
 */
export default fp(
  async (fastify) => {
    fastify.addHook('onReady', async () => {
      const log = (line: string) => fastify.log.info({ component: 'infra' }, line);
      await ensureNetwork(log);
      // The DB setting wins over NINEDEPLOY_ACME_EMAIL (env fallback).
      await ensureTraefik(log, await getAcmeEmail(fastify.db).catch(() => null));
      await writeDynamicConfig(fastify.db).catch((err) =>
        fastify.log.error({ err }, 'failed to write traefik dynamic config'),
      );
    });
  },
  { name: 'ninedeploy-traefik' },
);
