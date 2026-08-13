/** A one-click deploy template. Lives in the repo so the hub is self-hosted. */
export interface Template {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  emoji: string;
  image: string;
  port: number;
  volumeMount?: string;
  env?: Array<{ key: string; value: string; secret?: boolean }>;
  website?: string;
  docs?: string;
  featured?: boolean;
}

export const TEMPLATES: Template[] = [
  {
    id: 'n8n',
    name: 'n8n',
    tagline: 'Fair-code workflow automation',
    description:
      'n8n is an extendable workflow automation tool. Connect anything to everything via a node-based editor and run self-hosted workflows, integrations and automations with full control over your data.',
    category: 'Automation',
    emoji: '🔗',
    image: 'n8nio/n8n',
    port: 5678,
    volumeMount: '/home/node/.n8n',
    website: 'https://n8n.io',
    featured: true,
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    tagline: 'A fancy self-hosted monitoring tool',
    description:
      'Monitor HTTP(s), TCP, DNS, Docker and more with status pages, notifications and beautiful uptime charts. A drop-in, self-hosted alternative to UptimeRobot.',
    category: 'Monitoring',
    emoji: '📊',
    image: 'louislam/uptime-kuma:1',
    port: 3001,
    volumeMount: '/app/data',
    website: 'https://github.com/louislam/uptime-kuma',
    featured: true,
  },
  {
    id: 'grafana',
    name: 'Grafana',
    tagline: 'Dashboards & observability',
    description:
      'Query, visualize and alert on metrics, logs and traces from any data source. Build rich, interactive dashboards for your infrastructure and applications.',
    category: 'Monitoring',
    emoji: '📈',
    image: 'grafana/grafana',
    port: 3000,
    volumeMount: '/var/lib/grafana',
    env: [{ key: 'GF_SECURITY_ADMIN_PASSWORD', value: 'admin', secret: true }],
    website: 'https://grafana.com',
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    tagline: 'Self-hosted password manager',
    description:
      'An unofficial, lightweight Bitwarden-compatible server written in Rust. Securely store and sync passwords, passkeys and secrets across all your devices.',
    category: 'Security',
    emoji: '🔐',
    image: 'vaultwarden/server:latest',
    port: 8222,
    volumeMount: '/data',
    env: [{ key: 'ROCKET_PORT', value: '8222' }],
    website: 'https://github.com/dani-garcia/vaultwarden',
    featured: true,
  },
  {
    id: 'adminer',
    name: 'Adminer',
    tagline: 'Single-file database management',
    description:
      'A tiny PHP database client for MySQL, PostgreSQL, SQLite, MS SQL and more — all in a single file. Perfect for quick, ad-hoc database administration.',
    category: 'Database',
    emoji: '🗄️',
    image: 'adminer:4',
    port: 8080,
    website: 'https://www.adminer.org',
  },
  {
    id: 'redis-insight',
    name: 'Redis Insight',
    tagline: 'GUI for Redis',
    description:
      'Visualize and explore your Redis data, analyze memory usage and optimize your data structures with an intuitive desktop-quality web UI.',
    category: 'Database',
    emoji: '🔴',
    image: 'redis/redisinsight:latest',
    port: 5540,
    volumeMount: '/data',
    website: 'https://redis.com/redis-enterprise/redis-insight',
  },
  {
    id: 'libretranslate',
    name: 'LibreTranslate',
    tagline: 'Self-hosted machine translation',
    description:
      'A free, open-source machine translation API you can run entirely on your own infrastructure. Supports dozens of languages with no cloud dependencies.',
    category: 'AI',
    emoji: '🌐',
    image: 'libretranslate/libretranslate:latest',
    port: 5000,
    volumeMount: '/home/libretranslate',
    website: 'https://libretranslate.com',
  },
  {
    id: 'memos',
    name: 'Memos',
    tagline: 'Lightweight, self-hosted memos',
    description:
      'A fast, privacy-first note-taking service. Capture ideas, code snippets and knowledge with Markdown, tags and full-text search — all under your control.',
    category: 'Productivity',
    emoji: '📝',
    image: 'neosmemo/memos:stable',
    port: 5230,
    volumeMount: '/var/opt/memos',
    website: 'https://www.usememos.com',
    featured: true,
  },
];

export const TEMPLATE_CATEGORIES = ['All', ...Array.from(new Set(TEMPLATES.map((t) => t.category)))];
