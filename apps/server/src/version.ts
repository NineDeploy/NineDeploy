export const VERSION = '0.1.0';

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-08-14',
    title: 'Initial pre-release',
    changes: [
      'Deploy engine: Git repo (public/private) + Docker image, PM2 + Docker targets',
      'Zero-downtime blue-green releases with health checks and automatic rollback',
      'Auto-deploy webhooks: GitHub, GitLab, Gitea (HMAC verified, replay-safe)',
      'Live deploy logs via WebSocket + container exec terminal (xterm.js)',
      'Managed databases: PostgreSQL, MySQL, Redis, MongoDB (encrypted credentials)',
      'Backups (encrypted at rest) with daily scheduler and restore',
      'Traefik routing with automatic HTTPS (Let\'s Encrypt) and Cloudflare Tunnels',
      'Multi-user RBAC, audit log, rate limiting, master-key rotation',
      'Web dashboard, CLI, template hub (49 one-click apps)',
      'SQLite — zero external dependencies; 100% test coverage enforced in CI',
      'Metric-driven alert rules (CPU/memory/cert-expiry) with duration windows, cooldown, and recovery notifications',
      'New notification channels: Slack, ntfy, and email (SMTP with encrypted credentials)',
      'Retry with exponential backoff for failed notification deliveries',
      'TLS certificate expiry tracking on the Domains page with warning badges',
      'ACME email configurable from Settings (env fallback preserved)',
      'CLI parity: env, domains, volumes, backups, alerts, users, activity, system export/import, streaming logs',
      'Data-driven template registry: JSON bundle + swappable source (URL/path) with caching and offline fallback',
      'Wildcard SSL via ACME DNS-01 (Cloudflare, DigitalOcean, Hetzner, Linode, Gandi, DuckDNS) with encrypted API tokens',
      'Parallel deploy slots (NINEDEPLOY_DEPLOY_CONCURRENCY, 1-8) with per-service serialization',
      'Notification channel editing (pause/resume, rename, event filter) in Settings',
      'ACME staging directory support (NINEDEPLOY_ACME_CA_SERVER) and a hardened, installer-rendered systemd unit',
      'Integration test coverage: MySQL/Redis/MongoDB backup round-trips, end-to-end deploy + rollback',
    ],
  },
];

export const ABOUT = {
  name: 'NineDeploy',
  version: VERSION,
  description: 'Self-hosted deployment platform — deploy apps from Git or Docker Hub in one click.',
  license: 'MIT',
  repo: 'https://github.com/ninedeploy/ninedeploy',
  docs: 'https://github.com/ninedeploy/ninedeploy#readme',
  techStack: [
    { category: 'Runtime', items: ['Node.js ≥ 20', 'TypeScript 7 (strict)'] },
    { category: 'Backend', items: ['Fastify 5', 'Zod 4', 'WebSocket', 'Drizzle ORM'] },
    { category: 'Database', items: ['SQLite (libSQL)'] },
    { category: 'Frontend', items: ['React 19', 'Vite 8', 'Tailwind v4', 'React Flow'] },
    { category: 'Deploy', items: ['Docker (BuildKit)', 'PM2', 'Traefik v3', 'Cloudflare Tunnel'] },
    { category: 'Security', items: ['AES-256-GCM', 'JWT', 'Argon2', 'HMAC webhooks'] },
  ],
  changelog: CHANGELOG,
};
