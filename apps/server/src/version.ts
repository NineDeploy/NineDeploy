export const VERSION = '0.2.1';

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.1',
    date: '2026-08-18',
    title: 'CLI Package Rename & NPM Distribution Release',
    changes: [
      'Official npm publication setup for CLI and monorepo packages',
      'Renamed CLI package to ninedeploy for seamless `npx ninedeploy` and global npm install',
      'Public npm packaging configuration for @ninedeploy/sdk, @ninedeploy/schemas, @ninedeploy/plugin-sdk, and @ninedeploy/mcp',
      'Updated workspace release automation scripts and package dependency resolution',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-08-18',
    title: 'Workspaces, OIDC SSO, Microkernel & MCP Engine',
    changes: [
      'Multi-tenant Workspaces with 4-tier RBAC (Owner, Admin, Member, Viewer)',
      'Enterprise Single Sign-On via OpenID Connect (Google, GitHub, Keycloak, Okta)',
      'Hardware-backed Passkeys (WebAuthn / FIDO2) biometric authentication',
      'Microkernel event bus and waterfall hook pipeline (deploy.before / deploy.after)',
      'Central Configuration Center with Dual-Vault AES-256-GCM encryption & key rotation',
      'Plugin SDK with MenuRegistry and ServiceRegistry driver interchange',
      '35-tool Model Context Protocol (MCP) server for AI coding assistants (Claude, Cursor, Antigravity, Cline)',
      '100+ verified 1-click application templates with automated dependency resolution',
      'Live Container File Browser with drag-and-drop file operations',
      'Real-time Log Drains forwarding structured logs to Syslog, HTTP, and Datadog',
      'Ephemeral PR preview staging environments and 1-click demo stack',
    ],
  },
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
      'Web dashboard, CLI, template hub (48 one-click apps)',
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
      'Dashboard/Services routing fix, service Danger Zone (delete), in-use volume deletion protection (409)',
      'Template safety: auto-generated secrets (no more changeme), requirement hints, and auto-provisioned databases for DB-dependent apps',
      'Healthchecks fall back to sibling-container TCP probing so deploys work on Docker Desktop (macOS/Windows) too',
      'Template registry verified against real deployments: per-template commands, docker-socket flag, arm64/port fixes, auto-generated secrets, auto-provisioned databases',
      'ACME staging directory support (NINEDEPLOY_ACME_CA_SERVER) and a hardened, installer-rendered systemd unit',
      'Integration test coverage: MySQL/Redis/MongoDB backup round-trips, end-to-end deploy + rollback',
      'Tabbed Service Detail page: metrics sparklines, runtime metadata, service settings + build config editing, resource limits UI, per-domain SSL toggle, and a per-service activity trail',
      'PATCH /services/:id now persists build-config changes (previously parsed and discarded); GET returns build config + resource limits',
      'Dokploy-parity wave: deployment cancellation (checkpointed pipeline), watch-path webhooks (monorepo filters), MariaDB engine, www→apex redirects + custom response headers, TOTP two-factor authentication, S3-compatible off-site backup destinations (SigV4 client, zero deps), cron-scheduled jobs (deploys + container commands, croner), private-registry credentials (docker login via stdin), Docker Compose deployments, and an agent-based multi-server foundation (typed-operation protocol — remote hosts never accept raw commands)',
      'Password reset: forgot-password flow (single-use 30-min tokens, optional SMTP delivery via the notifier) + admin-issued one-time reset links (Users page / CLI)',
      'Per-account login lockout (5 failed attempts → 15 min) complementing the per-IP rate limit',
      'Release-channel installer: defaults to the latest release tag (--version pin, --channel main edge), snapshots .data before upgrades and health-checks the restart',
      'Update check: GET /v1/system/update-check (admin), About-page badge, `ninedeploy system update-check`',
      'About endpoint no longer leaks instance counts to unauthenticated callers',
      'systemd watchdog (Type=notify, WatchdogSec=90) with a dependency-free sd_notify client — hung processes restart automatically',
      'First-admin bootstrap is transactional (no dual-admin race)',
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
    { category: 'Runtime', items: ['Node.js ≥ 22.13', 'TypeScript 7 (strict)'] },
    { category: 'Backend', items: ['Fastify 5', 'Zod 4', 'WebSocket', 'Drizzle ORM'] },
    { category: 'Database', items: ['SQLite (node:sqlite)'] },
    { category: 'Frontend', items: ['React 19', 'Vite 8', 'Tailwind v4', 'React Flow'] },
    { category: 'Deploy', items: ['Docker (BuildKit)', 'PM2', 'Traefik v3', 'Cloudflare Tunnel'] },
    { category: 'Security', items: ['AES-256-GCM', 'JWT', 'Argon2', 'HMAC webhooks'] },
  ],
  changelog: CHANGELOG,
};
