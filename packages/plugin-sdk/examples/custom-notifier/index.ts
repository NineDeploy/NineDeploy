import { definePlugin } from '../../src/index.js';

export default definePlugin({
  id: 'custom-discord-notifier',
  name: 'Discord Webhook Notifier (Example)',
  version: '1.0.0',
  description: 'Streams deployment status changes to Discord with color-coded embeds.',
  author: 'Community Contributor',
  icon: 'Bot',

  configSchema: [
    {
      key: 'webhook_url',
      type: 'string',
      isSecret: true,
      label: 'Discord Webhook URL',
      required: true,
    },
    {
      key: 'notify_on_failure_only',
      type: 'boolean',
      isSecret: false,
      label: 'Notify on Failure Only',
      defaultValue: false,
    },
  ],

  menuItems: [
    {
      id: 'discord-overview-card',
      slot: 'dashboard:overview',
      label: 'Discord Alerts',
      route: '/settings?section=plugins',
      description: 'Active Discord notification channel',
      badge: 'Live',
    },
  ],

  async init(ctx) {
    ctx.logger.info('Custom Discord Notifier initialized in isolated sandbox');

    // Subscribe to direct deployment events
    ctx.on('deployment.status_changed', async (payload: any) => {
      const webhookUrl = await ctx.config.getSecret('webhook_url');
      if (!webhookUrl) {
        ctx.logger.warn('Discord webhook URL is not configured. Skipping alert.');
        return;
      }

      ctx.logger.info(`Sending alert for deploy #${payload?.deploymentId}: ${payload?.status}`);
    });

    // Intercept deployment pipeline with rollback capability
    ctx.tapHook(
      'deploy:before',
      async (payload) => {
        ctx.logger.info('Inspecting target service before build');
        return payload;
      },
      {
        priority: 110,
        rollback: async (_payload, error) => {
          ctx.logger.warn(`Deployment aborted or failed: ${error?.message}`);
        },
      },
    );
  },
});
