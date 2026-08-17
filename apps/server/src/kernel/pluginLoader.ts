import type { DB } from '@ninedeploy/db';
import { installedPlugins } from '@ninedeploy/db';
import { eq } from 'drizzle-orm';
import type { InstallPluginInput, MarketplacePluginItem } from '@ninedeploy/schemas';
import type { KernelContext, KernelPlugin } from './types.js';

export const MARKETPLACE_CATALOG: Omit<MarketplacePluginItem, 'isInstalled'>[] = [
  {
    id: 's3-backups',
    name: 'Amazon S3 & Cloudflare R2 Sync',
    version: '1.1.0',
    description: 'Automated off-site backup synchronization to Amazon S3, Cloudflare R2, Wasabi, or MinIO',
    author: 'NineDeploy Official',
    icon: 'HardDrive',
    category: 'storage',
    isOfficial: true,
    dependencies: [],
    configSchema: [
      {
        key: 'bucket_name',
        type: 'string',
        isSecret: false,
        label: 'S3 Bucket Name',
        category: 'plugin:s3-backups',
        tags: ['s3', 'storage'],
      },
      {
        key: 'access_key_id',
        type: 'string',
        isSecret: false,
        label: 'Access Key ID',
        category: 'plugin:s3-backups',
        tags: ['s3', 'auth'],
      },
      {
        key: 'secret_access_key',
        type: 'string',
        isSecret: true,
        label: 'Secret Access Key',
        category: 'plugin:s3-backups',
        tags: ['s3', 'secret'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'slack-alerts',
    name: 'Slack Notification Dispatcher',
    version: '1.0.0',
    description: 'Post deployment summaries, container crash alerts, and health warnings directly into Slack channels',
    author: 'NineDeploy Official',
    icon: 'MessageSquare',
    category: 'notifications',
    isOfficial: true,
    dependencies: ['notifications-dispatcher'],
    configSchema: [
      {
        key: 'webhook_url',
        type: 'string',
        isSecret: true,
        label: 'Slack Webhook URL',
        category: 'plugin:slack-alerts',
        tags: ['slack', 'notifications'],
      },
      {
        key: 'channel_override',
        type: 'string',
        isSecret: false,
        label: 'Channel Name',
        category: 'plugin:slack-alerts',
        tags: ['slack'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'discord-alerts',
    name: 'Discord Webhook Notifier',
    version: '1.0.0',
    description: 'Send color-coded rich embeds and server statistics to your Discord guild channels',
    author: 'Community Verified',
    icon: 'Bot',
    category: 'notifications',
    isOfficial: false,
    dependencies: ['notifications-dispatcher'],
    configSchema: [
      {
        key: 'webhook_url',
        type: 'string',
        isSecret: true,
        label: 'Discord Webhook URL',
        category: 'plugin:discord-alerts',
        tags: ['discord'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'datadog-apm',
    name: 'Datadog APM & DogStatsD',
    version: '1.0.0',
    description: 'Stream container resource metrics and trace logs to your Datadog monitoring dashboard',
    author: 'Community Verified',
    icon: 'BarChart',
    category: 'monitoring',
    isOfficial: false,
    dependencies: ['telemetry-streamer'],
    configSchema: [
      {
        key: 'api_key',
        type: 'string',
        isSecret: true,
        label: 'Datadog API Key',
        category: 'plugin:datadog-apm',
        tags: ['datadog', 'apm'],
      },
      {
        key: 'site',
        type: 'string',
        isSecret: false,
        label: 'Datadog Site (e.g. datadoghq.eu)',
        category: 'plugin:datadog-apm',
        tags: ['datadog'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'redis-sentinel',
    name: 'Redis Sentinel High Availability',
    version: '1.0.0',
    description: 'Automatic master failover and client routing for high-availability Redis topologies',
    author: 'NineDeploy Official',
    icon: 'Layers',
    category: 'database',
    isOfficial: true,
    dependencies: [],
    configSchema: [
      {
        key: 'master_name',
        type: 'string',
        isSecret: false,
        label: 'Sentinel Master Name',
        category: 'plugin:redis-sentinel',
        tags: ['redis'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'postgres-wal-g',
    name: 'PostgreSQL WAL-G Continuous Archiving',
    version: '1.0.0',
    description: 'Continuous WAL streaming and Point-in-Time-Recovery (PITR) for mission-critical PostgreSQL databases',
    author: 'Community Verified',
    icon: 'Database',
    category: 'database',
    isOfficial: false,
    dependencies: ['s3-backups'],
    configSchema: [],
    menuItems: [],
  },
  {
    id: 'github-app',
    name: 'GitHub App & CI/CD Webhooks',
    version: '1.0.0',
    description: 'Bi-directional GitHub App integration for commit statuses, PR preview environments, and instant webhook deployment triggers',
    author: 'NineDeploy Official',
    icon: 'Github',
    category: 'automation',
    isOfficial: true,
    dependencies: [],
    configSchema: [
      {
        key: 'app_id',
        type: 'string',
        isSecret: false,
        label: 'GitHub App ID',
        category: 'plugin:github-app',
        tags: ['github', 'ci'],
      },
      {
        key: 'private_key',
        type: 'string',
        isSecret: true,
        label: 'GitHub App Private Key (.pem)',
        category: 'plugin:github-app',
        tags: ['github', 'secret'],
      },
      {
        key: 'webhook_secret',
        type: 'string',
        isSecret: true,
        label: 'Webhook Secret',
        category: 'plugin:github-app',
        tags: ['github', 'webhook'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'prometheus-exporter',
    name: 'Prometheus & OpenTelemetry Exporter',
    version: '1.0.0',
    description: 'Exposes scrapeable /metrics endpoint with container CPU/Memory, network I/O, Traefik request counts, and system telemetry',
    author: 'NineDeploy Official',
    icon: 'Activity',
    category: 'monitoring',
    isOfficial: true,
    dependencies: [],
    configSchema: [
      {
        key: 'metrics_port',
        type: 'number',
        isSecret: false,
        label: 'Prometheus Metrics Port (default: 9100)',
        category: 'plugin:prometheus-exporter',
        tags: ['metrics', 'prometheus'],
      },
      {
        key: 'enable_auth',
        type: 'boolean',
        isSecret: false,
        label: 'Require Bearer Authentication',
        category: 'plugin:prometheus-exporter',
        tags: ['security'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'cloudflare-dns',
    name: 'Cloudflare DNS & Zero-Trust Automation',
    version: '1.0.0',
    description: 'Automated Cloudflare DNS record creation, proxy mode management, and Cloudflare Access service tokens',
    author: 'NineDeploy Official',
    icon: 'Cloud',
    category: 'networking',
    isOfficial: true,
    dependencies: [],
    configSchema: [
      {
        key: 'api_token',
        type: 'string',
        isSecret: true,
        label: 'Cloudflare API Token',
        category: 'plugin:cloudflare-dns',
        tags: ['cloudflare', 'dns'],
      },
      {
        key: 'zone_id',
        type: 'string',
        isSecret: false,
        label: 'Cloudflare Zone ID',
        category: 'plugin:cloudflare-dns',
        tags: ['cloudflare'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'sentry-tracking',
    name: 'Sentry Error & Performance Tracking',
    version: '1.0.0',
    description: 'Real-time error capturing, stack trace analysis, and deployment performance release tracking via Sentry',
    author: 'Community Verified',
    icon: 'AlertTriangle',
    category: 'monitoring',
    isOfficial: false,
    dependencies: [],
    configSchema: [
      {
        key: 'dsn',
        type: 'string',
        isSecret: true,
        label: 'Sentry Project DSN',
        category: 'plugin:sentry-tracking',
        tags: ['sentry', 'apm'],
      },
      {
        key: 'environment',
        type: 'string',
        isSecret: false,
        label: 'Release Environment (production/staging)',
        category: 'plugin:sentry-tracking',
        tags: ['sentry'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'tailscale-vpn',
    name: 'Tailscale Mesh VPN Integration',
    version: '1.0.0',
    description: 'Connect your NineDeploy instance and private deployment nodes to your Tailscale mesh network for secure, overlay networking',
    author: 'Community Verified',
    icon: 'Shield',
    category: 'networking',
    isOfficial: false,
    dependencies: [],
    configSchema: [
      {
        key: 'auth_key',
        type: 'string',
        isSecret: true,
        label: 'Tailscale Reusable Auth Key',
        category: 'plugin:tailscale-vpn',
        tags: ['tailscale', 'vpn'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'telegram-bot',
    name: 'Telegram Bot Incident Responder',
    version: '1.0.0',
    description: 'Interactive Telegram Bot for instant deployment alerts, container restart commands, and database backup reports',
    author: 'NineDeploy Official',
    icon: 'Send',
    category: 'notifications',
    isOfficial: true,
    dependencies: ['notifications-dispatcher'],
    configSchema: [
      {
        key: 'bot_token',
        type: 'string',
        isSecret: true,
        label: 'Telegram Bot Token',
        category: 'plugin:telegram-bot',
        tags: ['telegram'],
      },
      {
        key: 'chat_id',
        type: 'string',
        isSecret: false,
        label: 'Chat / Channel ID',
        category: 'plugin:telegram-bot',
        tags: ['telegram'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'crowdsec-security',
    name: 'CrowdSec Security & Intrusion Prevention',
    version: '1.0.0',
    description: 'Collaborative intrusion prevention system blocking brute-force attacks, port scans, and malicious bots on Traefik ingress',
    author: 'Community Verified',
    icon: 'Lock',
    category: 'security',
    isOfficial: false,
    dependencies: [],
    configSchema: [
      {
        key: 'lapi_url',
        type: 'string',
        isSecret: false,
        label: 'CrowdSec Local API URL',
        category: 'plugin:crowdsec-security',
        tags: ['crowdsec', 'security'],
      },
      {
        key: 'api_key',
        type: 'string',
        isSecret: true,
        label: 'Bouncer API Key',
        category: 'plugin:crowdsec-security',
        tags: ['crowdsec', 'secret'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'minio-s3-gateway',
    name: 'MinIO S3 Self-Hosted Storage Gateway',
    version: '1.0.0',
    description: 'High-performance, S3-compatible private object storage cluster provisioning and volume mirroring engine',
    author: 'NineDeploy Official',
    icon: 'HardDrive',
    category: 'storage',
    isOfficial: true,
    dependencies: [],
    configSchema: [
      {
        key: 'endpoint',
        type: 'string',
        isSecret: false,
        label: 'MinIO API Endpoint (e.g. minio.internal:9000)',
        category: 'plugin:minio-s3-gateway',
        tags: ['storage', 's3'],
      },
      {
        key: 'root_user',
        type: 'string',
        isSecret: false,
        label: 'MinIO Root User',
        category: 'plugin:minio-s3-gateway',
        tags: ['auth'],
      },
      {
        key: 'root_password',
        type: 'string',
        isSecret: true,
        label: 'MinIO Root Password',
        category: 'plugin:minio-s3-gateway',
        tags: ['secret'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'health-pinger',
    name: 'Uptime Sentinel & Health Pinger',
    version: '1.0.0',
    description: 'Multi-target active HTTP/TCP heartbeat pinger with latency histograms, auto-restart triggers, and SLA reports',
    author: 'NineDeploy Official',
    icon: 'Activity',
    category: 'monitoring',
    isOfficial: true,
    dependencies: ['notifications-dispatcher'],
    configSchema: [
      {
        key: 'ping_interval_seconds',
        type: 'number',
        isSecret: false,
        label: 'Ping Interval (seconds, default: 30)',
        category: 'plugin:health-pinger',
        tags: ['health'],
      },
      {
        key: 'timeout_ms',
        type: 'number',
        isSecret: false,
        label: 'Request Timeout (ms, default: 5000)',
        category: 'plugin:health-pinger',
        tags: ['health'],
      },
    ],
    menuItems: [],
  },
  {
    id: 'vault-secrets',
    name: 'HashiCorp Vault Secret Synchronization',
    version: '1.0.0',
    description: 'Dynamic secret leasing, token renewal, and automatic environment variable injection directly from HashiCorp Vault KV v2 engines',
    author: 'Community Verified',
    icon: 'Shield',
    category: 'security',
    isOfficial: false,
    dependencies: [],
    configSchema: [
      {
        key: 'vault_addr',
        type: 'string',
        isSecret: false,
        label: 'Vault Address URL (e.g. https://vault.internal:8200)',
        category: 'plugin:vault-secrets',
        tags: ['vault', 'security'],
      },
      {
        key: 'vault_token',
        type: 'string',
        isSecret: true,
        label: 'Vault Token / AppRole Secret ID',
        category: 'plugin:vault-secrets',
        tags: ['secret'],
      },
      {
        key: 'mount_path',
        type: 'string',
        isSecret: false,
        label: 'KV v2 Mount Path (default: secret)',
        category: 'plugin:vault-secrets',
        tags: ['vault'],
      },
    ],
    menuItems: [],
  },
];

export function getMarketplaceCatalog(installedIds: Set<string>): MarketplacePluginItem[] {
  return MARKETPLACE_CATALOG.map((item) => ({
    ...item,
    isInstalled: installedIds.has(item.id),
  }));
}

export function createDynamicPlugin(input: InstallPluginInput): KernelPlugin {
  let id = input.target;
  let name = input.name || input.target;
  let version = input.version || '1.0.0';
  let description = input.description;
  let author = input.author || 'External';
  let icon: string | undefined = input.icon ?? 'Box';
  let isOfficial = false;
  let configSchema: any[] | undefined = input.configSchema;
  let menuItems: any[] | undefined = input.menuItems;
  let dependencies: string[] | undefined = input.dependencies;

  if (input.source === 'marketplace') {
    const found = MARKETPLACE_CATALOG.find((m) => m.id === input.target);
    if (!found) {
      throw new Error(`Marketplace plugin "${input.target}" not found in catalog`);
    }
    id = found.id;
    name = found.name;
    version = found.version;
    description = found.description;
    author = found.author;
    icon = found.icon;
    isOfficial = found.isOfficial;
    configSchema = found.configSchema;
    menuItems = found.menuItems;
    dependencies = found.dependencies;
  } else if (input.source === 'npm') {
    // Sanitize npm package name to safe plugin ID
    id = input.target.replace(/^@/, '').replace(/[/@.]/g, '-').toLowerCase();
  } else if (input.source === 'git') {
    const match = input.target.match(/\/([^/]+?)(?:\.git)?$/);
    id = (match ? match[1]! : input.target).replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  }

  return {
    id,
    name,
    version,
    description,
    author,
    icon,
    isOfficial,
    dependencies,
    configSchema,
    menuItems,
    init: async (ctx: KernelContext) => {
      ctx.events.emit('plugin.status_changed', { pluginId: id, status: 'active' });
    },
    destroy: async () => {},
  };
}

export async function installPlugin(
  db: DB,
  kernel: KernelContext,
  input: InstallPluginInput,
): Promise<{ ok: boolean; id: string; status: string }> {
  const dynamicPlugin = createDynamicPlugin(input);

  // Check if already registered
  const existing = await db.query.installedPlugins.findFirst({
    where: eq(installedPlugins.id, dynamicPlugin.id),
  });

  if (existing && existing.enabled && kernel.getPlugin(dynamicPlugin.id)) {
    throw new Error(`Plugin "${dynamicPlugin.id}" is already installed and active`);
  }

  // Insert or update DB row
  await db.insert(installedPlugins).values({
    id: dynamicPlugin.id,
    name: dynamicPlugin.name,
    version: dynamicPlugin.version,
    isOfficial: !!dynamicPlugin.isOfficial,
    enabled: true,
    status: 'active',
    manifest: {
      description: dynamicPlugin.description,
      author: dynamicPlugin.author,
      source: input.source,
      target: input.target,
    },
  }).onConflictDoUpdate({
    target: installedPlugins.id,
    set: {
      enabled: true,
      status: 'active',
      error: null,
      updatedAt: new Date(),
    },
  });

  // Register into kernel if not already present
  if (!kernel.getPlugin(dynamicPlugin.id)) {
    await kernel.registerPlugin(dynamicPlugin);
  }

  kernel.events.emit('plugin.status_changed', { pluginId: dynamicPlugin.id, status: 'active' });

  return { ok: true, id: dynamicPlugin.id, status: 'active' };
}

export async function uninstallPlugin(
  db: DB,
  kernel: KernelContext,
  id: string,
): Promise<{ ok: boolean; id: string }> {
  const existing = await db.query.installedPlugins.findFirst({
    where: eq(installedPlugins.id, id),
  });

  if (!existing) {
    throw new Error(`Plugin "${id}" is not installed`);
  }

  // 1. Unregister and destroy runtime plugin if loaded
  await kernel.unregisterPlugin(id);

  // 2. Remove DB record
  await db.delete(installedPlugins).where(eq(installedPlugins.id, id));

  return { ok: true, id };
}

export async function loadInstalledPlugins(db: DB, kernel: KernelContext): Promise<number> {
  const rows = await db.query.installedPlugins.findMany({
    where: eq(installedPlugins.enabled, true),
  });

  let loaded = 0;
  for (const row of rows) {
    if (!kernel.getPlugin(row.id)) {
      try {
        const manifest = (row.manifest || {}) as Record<string, any>;
        const plugin = createDynamicPlugin({
          source: (manifest.source as any) || (row.isOfficial ? 'marketplace' : 'local'),
          target: (manifest.target as string) || row.id,
          name: row.name,
          version: row.version,
          description: row.description ?? undefined,
          author: row.author ?? undefined,
          icon: row.icon ?? undefined,
          configSchema: manifest.configSchema,
          menuItems: manifest.menuItems,
          dependencies: manifest.dependencies,
        });
        await kernel.registerPlugin(plugin);
        loaded++;
      } catch (err) {
        console.error(`[PluginLoader] Failed to restore plugin "${row.id}":`, err);
      }
    }
  }
  return loaded;
}
