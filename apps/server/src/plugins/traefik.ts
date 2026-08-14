import fp from 'fastify-plugin';
import { ensureNetwork, ensureTraefik, getAcmeEmail, getDnsConfig, writeDynamicConfig } from '../engine/proxy.js';

/**
 * Ensures the shared Docker network, the Traefik reverse proxy, and the dynamic
 * routing config are ready when the server starts.
 */
export default fp(
  async (fastify) => {
    fastify.addHook('onReady', async () => {
      const log = (line: string) => fastify.log.info({ component: 'infra' }, line);
      await ensureNetwork(log);
      // The DB settings win over the NINEDEPLOY_* env fallbacks.
      await ensureTraefik(
        log,
        await getAcmeEmail(fastify.db).catch(() => null),
        await getDnsConfig(fastify.db).catch(() => null),
      );
      await writeDynamicConfig(fastify.db).catch((err) =>
        fastify.log.error({ err }, 'failed to write traefik dynamic config'),
      );
    });
  },
  { name: 'ninedeploy-traefik' },
);
