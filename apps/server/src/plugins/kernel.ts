import fp from 'fastify-plugin';
import { config } from '../config.js';
import { LocalDockerDriver } from '../kernel/drivers/docker.js';
import { TraefikProxyDriver } from '../kernel/drivers/traefik.js';
import { NineDeployKernel } from '../kernel/kernel.js';
import { loadInstalledPlugins } from '../kernel/pluginLoader.js';
import { CloudflareTunnelsPlugin } from '../kernel/plugins/cloudflareTunnels.js';
import { NotificationsDispatcherPlugin } from '../kernel/plugins/notifications.js';
import { TelemetryStreamerPlugin } from '../kernel/plugins/telemetry.js';

// Augment the Fastify types so `fastify.kernel` and `req.kernel` are typed everywhere.
declare module 'fastify' {
  interface FastifyInstance {
    kernel: NineDeployKernel;
  }
  interface FastifyRequest {
    kernel: NineDeployKernel;
  }
}

export default fp(
  async (fastify) => {
    if (!fastify.kernel) {
      const kernel = new NineDeployKernel(fastify.db, config);

      // Register default core drivers
      kernel.registry.registerCompute(new LocalDockerDriver());
      kernel.registry.registerProxy(new TraefikProxyDriver(fastify.db));

      // Register official built-in plugins
      await kernel.registerPlugin(new NotificationsDispatcherPlugin());
      await kernel.registerPlugin(new CloudflareTunnelsPlugin());
      await kernel.registerPlugin(new TelemetryStreamerPlugin());

      fastify.decorate('kernel', kernel);
      fastify.decorateRequest('kernel', {
        getter() {
          return fastify.kernel;
        },
      });

      fastify.addHook('onReady', async () => {
        try {
          await loadInstalledPlugins(fastify.db, kernel);
          await kernel.boot();
          fastify.log.info({ state: kernel.state }, 'NineDeploy microkernel booted successfully');
        } catch (err) {
          fastify.log.error({ err }, 'Failed to boot NineDeploy microkernel');
        }
      });

      fastify.addHook('onClose', async () => {
        try {
          await kernel.shutdown();
          fastify.log.info('NineDeploy microkernel gracefully terminated');
        } catch (err) {
          fastify.log.error({ err }, 'Error shutting down NineDeploy microkernel');
        }
      });
    }
  },
  {
    name: 'ninedeploy-kernel',
  },
);
