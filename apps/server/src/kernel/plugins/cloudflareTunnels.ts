import type { KernelContext, KernelPlugin } from '../types.js';

export class CloudflareTunnelsPlugin implements KernelPlugin {
  readonly id = 'cloudflare-tunnels';
  readonly name = 'Cloudflare Zero Trust Tunnels';
  readonly version = '1.0.0';
  readonly description = 'Expose services securely to the internet without opening inbound firewall ports via Cloudflare Tunnel';
  readonly author = 'NineDeploy Core';
  readonly icon = 'ShieldCheck';
  readonly isOfficial = true;

  readonly configSchema = [
    {
      key: 'account_id',
      type: 'string' as const,
      isSecret: false,
      label: 'Cloudflare Account ID',
      category: 'plugin:cloudflare-tunnels',
      description: 'Your Cloudflare Zero Trust account ID',
      tags: ['cloudflare', 'network'],
    },
    {
      key: 'tunnel_token',
      type: 'string' as const,
      isSecret: true,
      label: 'Tunnel Token',
      category: 'plugin:cloudflare-tunnels',
      description: 'Cloudflare tunnel runner authentication token',
      tags: ['cloudflare', 'secret', 'auth'],
    },
  ];

  readonly menuItems = [
    {
      id: 'cf-tunnels-nav',
      slot: 'sidebar:secondary' as const,
      label: 'Cloudflare Tunnels',
      route: '/tunnels',
      icon: 'Globe',
      order: 40,
      permission: 'admin' as const,
    },
  ];

  private unsubs: Array<() => void> = [];

  init(ctx: KernelContext): void {
    // Tap deploy after hook to verify route exposure
    const unhook = ctx.hooks.tap(
      'deploy.after',
      async (context) => {
        const deployCtx = context as { serviceId?: number; domain?: string };
        ctx.events.emit('tunnel.route_evaluated', {
          serviceId: deployCtx.serviceId,
          domain: deployCtx.domain,
        });
        return deployCtx;
      },
      { priority: 50 },
    );

    this.unsubs.push(unhook);
  }

  destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
