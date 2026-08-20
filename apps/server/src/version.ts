export const VERSION = '0.2.25';

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.25',
    date: '2026-08-20',
    title: 'Visible Deployment Progress',
    changes: [
      'Silent deployment commands emit elapsed-time activity heartbeats so the panel never presents active work as frozen',
      'Normal stdout and stderr postpone heartbeats, preserving readable logs while still detecting genuinely silent work',
      'Registry export, filesystem packaging, and Docker image import identify their current recovery phase every 15 seconds',
      'Heartbeat labels never expose subprocess arguments that may contain credentials or other sensitive values',
    ],
  },
  {
    version: '0.2.24',
    date: '2026-08-20',
    title: 'Containerd Transfer Platform Recovery',
    changes: [
      'Native snapshot recovery explicitly selects the host Linux platform for multi-platform OCI image indexes',
      'Containerd 2 transfer API unpack failures retry through ctr local mode before falling back to direct registry export',
      'Native image mounts use the same explicit platform so WordPress and other multi-architecture images resolve consistently',
    ],
  },
  {
    version: '0.2.23',
    date: '2026-08-20',
    title: 'Hub-Wide Snapshot Recovery Certification',
    changes: [
      'Every runtime-certified Hub application now passes forced snapshotter-independent export, import, startup and TCP probing',
      'WordPress plus MySQL and Directus plus PostgreSQL pass the same recovery path with real database initialization and wiring',
      'Docker Hub, GHCR and Codeberg registry images are covered by one image-independent recovery implementation',
      'The checksum-verified registry tool is reused safely within the server process and pinned to a BusyBox-compatible release',
    ],
  },
  {
    version: '0.2.22',
    date: '2026-08-20',
    title: 'Snapshotter-Independent Registry Recovery',
    changes: [
      'Images recover directly from their registry when both Docker overlayfs and containerd native snapshotters are unusable',
      'The fallback uses a pinned and checksum-verified crane binary to flatten the image into a fresh single-layer chain',
      'OCI environment, entrypoint, command, ports, volumes, labels, user, working directory and healthcheck metadata are retained',
      'A destructive-state-free MySQL 8.4 smoke test proves registry export, Docker import and database readiness end to end',
    ],
  },
  {
    version: '0.2.21',
    date: '2026-08-20',
    title: 'Runtime-Certified Template Hub',
    changes: [
      'The Hub fails closed and exposes only templates that passed isolated container startup and declared-port probes',
      'Fifteen application templates are runtime-certified; the rest stay hidden until tested individually',
      'A reusable smoke runner verifies real image, environment, command, volume, process and Docker-network port behavior',
      'Website and product copy no longer confuse registry manifest checks with runtime verification',
    ],
  },
  {
    version: '0.2.20',
    date: '2026-08-20',
    title: 'Honest and Working Template Deployments',
    changes: [
      'The Hub now publishes only templates compatible with its current one-application and optional one-database deployment model',
      'WordPress, Directus, and every supported database template receive their image-specific connection environment variables',
      'CLI template deploys provision and attach managed databases before the application is queued',
      'All 88 bundled images pass a real OCI manifest check, with corrected Memos, Forgejo, and Kavita references',
      'Real WordPress plus MySQL and Directus plus PostgreSQL container boots validate the database mappings',
    ],
  },
  {
    version: '0.2.19',
    date: '2026-08-20',
    title: 'End-to-End Ubuntu Runtime Reliability',
    changes: [
      'Every internal helper image is explicitly prepared through the shared Docker and containerd recovery path before docker run',
      'Traefik startup, updates, remote agents, database studios, tunnels, health probes, and volume tools now share one reliable image lifecycle',
      'Ubuntu installs use a consistent elevated Docker command path, run the host control-plane with the privileges its Docker trust boundary requires, and verify the real HTTP ingress',
      'Automatically assigned wildcard domains enable HTTPS whenever an ACME account is configured',
    ],
  },
  {
    version: '0.2.18',
    date: '2026-08-20',
    title: 'Targeted Containerd Snapshot Repair',
    changes: [
      'Unused committed overlayfs snapshots that block image extraction are safely removed through containerd dependency checks',
      'Recovery commands explicitly connect to Docker external or daemon-managed containerd sockets',
      'Deployment errors expose the native recovery failure when every snapshot recovery strategy fails',
    ],
  },
  {
    version: '0.2.17',
    date: '2026-08-20',
    title: 'Managed Database Snapshot Recovery',
    changes: [
      'Managed database images are explicitly pulled through the Docker 29 and containerd snapshot recovery path before startup',
      'MySQL and other database deployments no longer rely on docker run implicit image pulls that fail opaquely with code 125',
      'Image preparation failures stop before existing container state or temporary secret environment files are mutated',
    ],
  },
  {
    version: '0.2.16',
    date: '2026-08-20',
    title: 'Panel Autofill Rejection',
    changes: [
      'Authenticated panel inputs reject browser and password-manager autofill, autocomplete, autocorrect, and spellcheck',
      'Dynamically mounted dialog and plugin fields inherit the same no-autofill policy',
      'The Settings filter stays locked until deliberate interaction and clears detected browser autofill injection',
    ],
  },
  {
    version: '0.2.15',
    date: '2026-08-20',
    title: 'Persistent Docker Snapshot Recovery',
    changes: [
      'Persistent Docker 29 and containerd overlayfs snapshot collisions recover through the isolated native snapshotter',
      'Recovered images retain their runtime metadata, filesystem ownership, capabilities, ACLs, and extended attributes',
      'Snapshot recovery never deletes or hides existing Docker images, containers, or volumes',
    ],
  },
  {
    version: '0.2.14',
    date: '2026-08-20',
    title: 'End-to-End Hub Retry Recovery',
    changes: [
      'Interrupted Hub deployments resume only a matching caller-owned idle service',
      'Template environment variables, managed databases, and database attachments are safely reconciled on retry',
      'Retries no longer fail on partial-install service, environment, database, container, or attachment collisions',
    ],
  },
  {
    version: '0.2.13',
    date: '2026-08-20',
    title: 'Reliable Hub Database Provisioning',
    changes: [
      'Managed database startup reconciles Docker daemon state after a late docker run code 125 failure',
      'A database container that is already running is adopted instead of leaving its control-plane row in an error state',
      'Hub template retries safely resume only a matching caller-owned database and no longer collide with its existing slug or container name',
    ],
  },
  {
    version: '0.2.12',
    date: '2026-08-20',
    title: 'Automatic Docker Image Port Recovery',
    changes: [
      'Failed Docker healthchecks probe TCP ports declared by image metadata and recover an incorrect configured internal port automatically',
      'A recovered image port is persisted so Traefik and future deployments use the corrected value',
      'n8n image deployments configured with port 80 automatically recover to the image-declared 5678/tcp port',
    ],
  },
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
      'Hardened installer-rendered systemd service with HTTP readiness verification',
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
