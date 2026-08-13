export const VERSION = '1.0.0';

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-08-13',
    title: 'Initial release',
    changes: [
      'Deploy engine: Git repo (public/private) + Docker image, PM2 + Docker targets',
      'BuildKit + Nixpacks support, health checks with configurable path',
      'Auto-deploy webhooks: GitHub, GitLab, Gitea (HMAC verified)',
      'Live deploy logs via WebSocket streaming',
      'One-click rollback to any previous deployment',
      'Container exec terminal (xterm.js over WebSocket)',
      'Service lifecycle: stop / start / restart from dashboard',
      'Managed databases: PostgreSQL, MySQL, Redis, MongoDB',
      'Auto-generated credentials (AES-256-GCM encrypted)',
      'DATABASE_URL auto-injection into attached services',
      'Database wizard (stepper) + volume retention & auto-reuse',
      'Backups: pg_dump / mongodump + restore + download, daily scheduler',
      'Template Hub: 8 one-click apps (n8n, Grafana, Uptime Kuma, Vaultwarden…)',
      'Multi-step deploy wizard: Source → Runtime → Env → Resources → Review',
      'Traefik reverse proxy with automatic HTTPS (TLS)',
      'Cloudflare Tunnel support (zero open ports)',
      'Container security: ports bound to 127.0.0.1 only',
      'Domain management: routing map + SSL toggle',
      'Topology graph: interactive React Flow (services ↔ databases ↔ domains)',
      'Monitoring: live CPU/memory per container + sparklines + host overview',
      'Resource limits: CPU shares + memory caps per service/database',
      'Volume inventory: list, inspect, delete, Docker resources + prune',
      'Multi-user management: roles (admin/member), audit log, activity feed',
      'Dark/Light theme + 6 accent color palettes',
      'Command palette (⌘K): fuzzy search across everything',
      'Toast notification system',
      'Two-level icon rail menu (activity bar + secondary panel)',
      'Right drawer: live activity feed',
      'Private repo auth: PAT (HTTPS) + SSH deploy keys',
      'Encrypted secrets: env vars masked, never returned by API',
      'JWT auth (access + refresh) + API tokens for CLI/CI',
      'CLI: setup, login, whoami, services list, token create',
      'One-click installer (install.sh) + systemd service',
      'SQLite — zero external database dependencies',
      'TypeScript 7 strict, React 19, Vite 8, Tailwind v4, Drizzle ORM',
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
