import type { KernelContext, KernelPlugin } from '../types.js';

export class NotificationsDispatcherPlugin implements KernelPlugin {
  readonly id = 'notifications-dispatcher';
  readonly name = 'Event-Driven Notification Dispatcher';
  readonly version = '1.0.0';
  readonly description = 'Subscribes to domain events and dispatches alerts to configured channels (Telegram, Discord, Slack, Webhooks)';
  readonly author = 'NineDeploy Core';
  readonly icon = 'Bell';
  readonly isOfficial = true;

  readonly configSchema = [
    {
      key: 'rate_limit_per_minute',
      type: 'number' as const,
      isSecret: false,
      label: 'Max Alerts Per Minute',
      category: 'plugin:notifications-dispatcher',
      defaultValue: 30,
      description: 'Prevents alert storming during cascade container restarts',
      tags: ['notifications', 'rate-limit'],
    },
    {
      key: 'alert_on_deploy_success',
      type: 'boolean' as const,
      isSecret: false,
      label: 'Alert on Deployment Success',
      category: 'plugin:notifications-dispatcher',
      defaultValue: true,
      tags: ['notifications', 'deploy'],
    },
  ];

  readonly menuItems = [
    {
      id: 'notifications-dispatcher-command',
      slot: 'command:palette' as const,
      label: 'Notification Channels',
      route: '/settings?section=notifications',
      icon: 'Bell',
      order: 80,
      permission: 'admin' as const,
    },
  ];

  private unsubs: Array<() => void> = [];

  init(ctx: KernelContext): void {
    // 1. Listen for deployment events
    const unsub1 = ctx.events.on('deployment.status_changed', (payload) => {
      const data = payload as { deploymentId?: number; status?: string; serviceName?: string };
      ctx.events.emit('notification.queued', {
        title: `Deployment ${data.status ?? 'Updated'}`,
        body: `Service ${data.serviceName ?? 'Unknown'} deployment #${data.deploymentId ?? 0} changed to ${data.status}`,
        level: data.status === 'failed' ? 'error' : 'info',
      });
    });

    // 2. Listen for service health changes
    const unsub2 = ctx.events.on('service.health_changed', (payload) => {
      const data = payload as { serviceId?: number; status?: string };
      if (data.status === 'unhealthy' || data.status === 'dead') {
        ctx.events.emit('notification.queued', {
          title: `Service Health Alert`,
          body: `Service #${data.serviceId ?? 0} transitioned to ${data.status}`,
          level: 'error',
        });
      }
    });

    // 3. Listen for backup completion/failures
    const unsub3 = ctx.events.on('backup.completed', (payload) => {
      const data = payload as { databaseId?: number; sizeBytes?: number };
      ctx.events.emit('notification.queued', {
        title: 'Database Backup Completed',
        body: `Database #${data.databaseId ?? 0} backup succeeded (${data.sizeBytes ?? 0} bytes)`,
        level: 'info',
      });
    });

    this.unsubs.push(unsub1, unsub2, unsub3);
  }

  destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
