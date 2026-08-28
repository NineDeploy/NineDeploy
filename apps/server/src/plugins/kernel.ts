import fp from 'fastify-plugin';
import { config } from '../config.js';
import { LocalDockerDriver } from '../kernel/drivers/docker.js';
import { TraefikProxyDriver } from '../kernel/drivers/traefik.js';
import { CloudflareZoneProvider } from '../kernel/drivers/cloudflareZone.js';
import { DnsimpleProvider } from '../kernel/drivers/dnsimple.js';
import { NineDeployKernel } from '../kernel/kernel.js';
import { bridgeAuditEvents } from '../kernel/auditBridge.js';
import { eventBus } from '../lib/events.js';
import { getDnsRecordsConfig } from '../lib/cloudflare.js';
import { getDnsimpleConfig } from '../lib/dnsimple.js';
import { loadInstalledPlugins } from '../kernel/pluginLoader.js';
import { CloudflareTunnelsPlugin } from '../kernel/plugins/cloudflareTunnels.js';
import { ManifestGeneratorPlugin } from '../kernel/plugins/manifestGenerator.js';
import { NotificationsDispatcherPlugin } from '../kernel/plugins/notifications.js';
import { TemplateBundlesPlugin } from '../kernel/plugins/templateBundles.js';
import { TelemetryStreamerPlugin } from '../kernel/plugins/telemetry.js';
import { WebhookOutPlugin } from '../kernel/plugins/webhookOut.js';

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
      // Default domain provider — reads the same global DNS settings the
      // legacy `lib/cloudflare.ts` callers already use, so a token saved via
      // Settings → DNS works here too. Gaps in configuration surface as a
      // null token, and every method on the driver will then fail with a
      // descriptive error instead of crashing the kernel.
      kernel.registry.registerDomainProvider(
        new CloudflareZoneProvider(async () => {
          try {
            const cfg = await getDnsRecordsConfig(fastify.db);
            return cfg.enabled && cfg.token ? cfg.token : null;
          } catch {
            return null;
          }
        }),
      );
      // Sibling driver for DNSimple. Mirrors the Cloudflare wiring — the
      // credentials supplier is a closure over `fastify.db`, and a missing
      // setting surfaces as `null`, so the driver fails with a descriptive
      // error rather than crashing the boot. Operators pick which driver
      // a service uses via `dns_records_provider=cloudflare|dnsimple`.
      kernel.registry.registerDomainProvider(
        new DnsimpleProvider(async () => {
          try {
            const cfg = await getDnsimpleConfig(fastify.db);
            return cfg.enabled && cfg.token && cfg.accountId
              ? { token: cfg.token, accountId: cfg.accountId }
              : null;
          } catch {
            return null;
          }
        }),
      );

      // Register official built-in plugins
      await kernel.registerPlugin(new NotificationsDispatcherPlugin());
      await kernel.registerPlugin(new CloudflareTunnelsPlugin());
      await kernel.registerPlugin(new TelemetryStreamerPlugin());
      await kernel.registerPlugin(new TemplateBundlesPlugin());
      await kernel.registerPlugin(new ManifestGeneratorPlugin());
      await kernel.registerPlugin(new WebhookOutPlugin());

      fastify.decorate('kernel', kernel);
      fastify.decorateRequest('kernel', {
        getter() {
          return fastify.kernel;
        },
      });

      // Feed the kernel bus from the real application event stream. Without
      // this the bus is inert: the built-in plugins subscribe to event names
      // that no code ever emitted, so they ran on every install and did
      // nothing. `audit()` is the one choke point every state change already
      // passes through — see kernel/auditBridge.ts.
      let detachAuditBridge: (() => void) | undefined;

      fastify.addHook('onReady', async () => {
        try {
          await loadInstalledPlugins(fastify.db, kernel);
          await kernel.boot();
          detachAuditBridge = bridgeAuditEvents((cb) => eventBus.subscribe(cb), kernel.events);
          fastify.log.info({ state: kernel.state }, 'NineDeploy microkernel booted successfully');
        } catch (err) {
          fastify.log.error({ err }, 'Failed to boot NineDeploy microkernel');
        }
      });

      fastify.addHook('onClose', async () => {
        try {
          detachAuditBridge?.();
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
