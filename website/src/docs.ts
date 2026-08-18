export type Block =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "code"; file?: string; body: string }
  | { kind: "list"; items: string[] }
  | { kind: "callout"; tone: "info" | "warn"; title: string; text: string };

export type Doc = {
  slug: string;
  title: string;
  description: string;
  group: string;
  blocks: Block[];
};

export const docs: Doc[] = [
  {
    slug: "introduction",
    title: "Introduction",
    description: "What NineDeploy is, and why it looks like this.",
    group: "Start",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy is a self-hosted deployment platform and PaaS. It wraps PM2 and Docker behind a sleek web dashboard, a fast CLI and a 26-tool MCP server, fronts everything with Traefik, and handles webhooks, managed databases, monitoring, alerts, notifications, and backups. All state lives in a single SQLite database on your server — zero external database dependencies.",
      },
      { kind: "h2", text: "The shape of the system" },
      {
        kind: "list",
        items: [
          "Core server (Fastify + Microkernel) runs bare-metal under systemd for direct Docker daemon + PM2 access — or in a single Docker container.",
          "Remote hosts run the same binary in agent mode (NINEDEPLOY_AGENT=1) and execute a fixed table of typed, sanitized operations.",
          "All application containers live on a shared Docker network; only Traefik is exposed on :80/:443.",
          "The web dashboard is served directly by the API process — one process, one port, zero orchestration overhead.",
        ],
      },
      { kind: "h2", text: "Design principles" },
      {
        kind: "list",
        items: [
          "No host ports exposed on apps — healthchecks probe internal container IPs, Traefik routes traffic by hostname.",
          "Every subprocess has a hard timeout with tree-kill; a hung build or script can never stall the deployment queue.",
          "Secrets are AES-256-GCM encrypted in versioned envelopes with a rotatable key ring.",
          "100% test coverage enforced in CI across every package — no exceptions.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Requirements",
        text: "Node ≥ 22.13, Docker, and a Linux host (or macOS for local development). That's the complete list.",
      },
    ],
  },
  {
    slug: "installation",
    title: "Installation",
    description: "Three ways up: one-click, Docker, or from source.",
    group: "Start",
    blocks: [
      { kind: "h2", text: "One-click (bare-metal, recommended)" },
      {
        kind: "code",
        body: "curl -fsSL https://raw.githubusercontent.com/NineDeploy/NineDeploy/main/install.sh | bash",
      },
      {
        kind: "p",
        text: "The installer validates Node ≥ 22.13 and Docker, clones the repository, renders a hardened systemd unit (Type=notify, WatchdogSec=90, ProtectSystem=strict) and enables the service. Open http://localhost:3000 to create the initial admin account.",
      },
      { kind: "h2", text: "Docker" },
      {
        kind: "code",
        body: `docker run -d --name ninedeploy \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v ninedeploy-data:/data \\
  -p 3000:3000 \\
  -e NINEDEPLOY_JWT_SECRET=$(openssl rand -hex 32) \\
  ghcr.io/ninedeploy/ninedeploy`,
      },
      {
        kind: "p",
        text: "All state (SQLite, repos, logs, backups, master keys) persists in the volume; database migrations apply automatically on boot. PM2 services require bare-metal mode; Docker containers and templates work in both modes.",
      },
      { kind: "h2", text: "From source" },
      {
        kind: "code",
        body: `git clone https://github.com/NineDeploy/NineDeploy.git
cd ninedeploy && pnpm install && cp .env.example .env
pnpm build && pnpm dev`,
      },
      { kind: "h2", text: "Upgrades" },
      {
        kind: "p",
        text: "Re-running install.sh performs an atomic in-place upgrade: snapshots the database, checks out the release (latest by default, --channel main for edge, --version to pin), rebuilds, runs migrations, and gates the restart on /health.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "JWT secret",
        text: "The server refuses to boot in production with the insecure default JWT secret. Generate one using: openssl rand -hex 32.",
      },
    ],
  },
  {
    slug: "deploy-pipeline",
    title: "Deploy pipeline",
    description: "Trigger → claim → build → healthcheck → flip → retire.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "Deploys are tracked as atomic database records, claimed by concurrent worker slots (NINEDEPLOY_DEPLOY_CONCURRENCY, default 1, max 8). The same service is never deployed concurrently. Stranded deployments from abrupt restarts are swept automatically on boot.",
      },
      {
        kind: "list",
        items: [
          "Trigger: manual UI button, webhook (HMAC + branch + watch-path globs + replay dedup), CLI command, cron schedule, or template hub.",
          "Build: git clone with credentials (scrubbed after checkout) or Docker image pull with per-source registry credentials.",
          "Blue-green: the new container starts on the shared network while the existing version continues handling live traffic.",
          "Healthcheck: container liveness check plus HTTP probes against the container IP — isolated per attempt with hard timeouts.",
          "Flip: Traefik's dynamic routing configuration is rewritten atomically; only then is the previous container retired.",
          "Automatic rollback: on failure, the new container is destroyed and the previous healthy release keeps running.",
          "Cancellation: in-flight builds can be cancelled at any stage, immediately stopping subprocesses and cleaning up containers.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Rollback pins digests",
        text: "Each deployment records the exact immutable image digest. Rollback redeploys that exact digest — never an altered :latest tag.",
      },
    ],
  },
  {
    slug: "workspaces-rbac",
    title: "Workspaces & RBAC",
    description: "Multi-tenant workspace isolation and role-based permissions.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy organizes projects, services, databases, volumes, and credentials into isolated workspaces. Team members can belong to multiple workspaces with distinct roles.",
      },
      { kind: "h2", text: "Roles & Privileges" },
      {
        kind: "list",
        items: [
          "Owner: Full system access, workspace deletion, billing/licensing, and transfer of ownership.",
          "Admin: Create/edit/delete services, manage secrets, configure alert rules, invite and manage members.",
          "Member: Deploy existing services, view logs, view container metrics, and restart applications.",
          "Viewer: Read-only access to service statuses, build logs, and topology views without mutation rights.",
        ],
      },
      { kind: "h2", text: "Team Invitations" },
      {
        kind: "p",
        text: "Invite team members via email with role assignment. When SMTP is configured, an invitation link is dispatched automatically; otherwise, admins can copy the single-use token from the dashboard.",
      },
    ],
  },
  {
    slug: "databases",
    title: "Managed databases",
    description: "Postgres (pgvector), MySQL, MariaDB, Redis, Valkey, ClickHouse, Meilisearch, RabbitMQ, Mongo.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "One-click managed databases with persistent volume attachments, CPU/memory limits, Web Studio management, and credentials encrypted at rest. Attaching a database to a service injects standard connection strings automatically.",
      },
      { kind: "h2", text: "Supported Engines" },
      {
        kind: "list",
        items: [
          "PostgreSQL (with pgvector AI extension support)",
          "MySQL 8 & MariaDB 11",
          "Redis 7 & Valkey 8 in-memory caches",
          "ClickHouse analytical column store",
          "Meilisearch fast search engine",
          "RabbitMQ message broker",
          "MongoDB 7 document database",
        ],
      },
      { kind: "h2", text: "Backups & S3 Replication" },
      {
        kind: "list",
        items: [
          "Automated engine dumps sealed with AES-256 encryption the moment they hit the filesystem.",
          "Daily scheduled backups with automated 7-day retention; manual snapshots are preserved permanently.",
          "Off-site replication to any S3 endpoint (AWS, MinIO, Cloudflare R2, Backblaze B2) using zero-dependency SigV4 signing.",
          "One-click restore fetches the remote archive if local copy is missing, validated against path-traversal / tar-slip.",
        ],
      },
    ],
  },
  {
    slug: "multi-server",
    title: "Multi-server & Nodes",
    description: "Typed agent protocol, SSH zero-touch provisioning, and cluster management.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "Deploy workloads across multiple servers. Remote nodes run the same NineDeploy binary with NINEDEPLOY_AGENT=1, communicating over a strictly typed RPC protocol.",
      },
      { kind: "h2", text: "Zero-Touch SSH Provisioning" },
      {
        kind: "p",
        text: "Bootstrap fresh Linux VPS instances directly from the web dashboard. Enter IP, SSH user, and private key — NineDeploy connects, installs Docker and dependencies, configures the agent, and securely links it to your cluster.",
      },
      { kind: "h2", text: "Security & Validation" },
      {
        kind: "list",
        items: [
          "Strict typed operations (docker pull/build/run, compose up/down, git checkout) — no raw shell execution over the wire.",
          "Operand validation regexes enforced at both controller and agent boundaries.",
          "Node health monitoring with heartbeat pings and CPU/memory metric streaming.",
          "Per-service migration bundles for exporting and moving services between nodes with zero data loss.",
        ],
      },
    ],
  },
  {
    slug: "ingress-traefik-tunnels",
    title: "Ingress, SSL & Tunnels",
    description: "Traefik reverse proxy, Let's Encrypt certificates, and Cloudflare Tunnels.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "All incoming HTTP and HTTPS traffic is routed through an integrated Traefik reverse proxy. Applications do not expose host ports.",
      },
      { kind: "h2", text: "SSL & Wildcard Domains" },
      {
        kind: "list",
        items: [
          "Automatic Let's Encrypt HTTP-01 challenge for custom domains.",
          "Cloudflare DNS-01 integration for wildcard certificates (*.yourdomain.com).",
          "Automatic subdomains: configure NINEDEPLOY_WILDCARD_DOMAIN to auto-assign {service-name}.yourdomain.com.",
          "Dynamic middleware: basic auth, rate limiting, IP whitelisting, and gzip/brotli compression.",
        ],
      },
      { kind: "h2", text: "Cloudflare Tunnels" },
      {
        kind: "p",
        text: "Expose self-hosted services without opening router ports or exposing public IPs. Connect a Cloudflare Tunnel token in Settings, and NineDeploy proxies traffic through Cloudflare's edge securely.",
      },
    ],
  },
  {
    slug: "security-sso",
    title: "Security, SSO & Passkeys",
    description: "WebAuthn, OIDC Single Sign-On, TOTP 2FA, brute-force lockout, and AES-256 key rotation.",
    group: "Security",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy follows a defense-in-depth security model built into every layer.",
      },
      { kind: "h2", text: "Authentication Options" },
      {
        kind: "list",
        items: [
          "Passkeys (WebAuthn): Biometric and hardware FIDO2 key login without passwords.",
          "OIDC Single Sign-On: Turnkey integration for Google, GitHub, Okta, Keycloak, and generic OpenID Connect.",
          "Two-Factor Authentication (TOTP): RFC 6238 time-based one-time passwords for password logins.",
          "Argon2id password hashing with hardened parameters.",
        ],
      },
      { kind: "h2", text: "Secrets & Key Rotation" },
      {
        kind: "list",
        items: [
          "Environment secrets and database passwords are encrypted with AES-256-GCM in versioned envelopes.",
          "Zero-downtime key rotation: configure NINEDEPLOY_MASTER_KEYS=0:old_key,1:new_key to seamlessly re-encrypt secrets.",
          "Account lockout: 5 failed consecutive login attempts lock the account for 15 minutes.",
          "Session revocation: password resets immediately invalidate all active JWT tokens and sessions.",
        ],
      },
    ],
  },
  {
    slug: "alerts-notifications",
    title: "Alerts & Notifications",
    description: "Sustained breach metric monitoring and multi-channel alerting.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "Define metric alert rules to stay ahead of performance degradation and downtime. Background workers collect CPU, memory, disk usage, and SSL certificate expiration windows.",
      },
      { kind: "h2", text: "Supported Channels" },
      {
        kind: "list",
        items: [
          "Telegram (bot token + chat ID)",
          "Discord (webhook URL)",
          "Slack (incoming webhook)",
          "Ntfy (self-hosted or public push notification topics)",
          "Generic Webhook (HMAC signed JSON payload)",
          "Email (SMTP relay with custom templates)",
        ],
      },
      { kind: "h2", text: "Sustained Breach Windows" },
      {
        kind: "p",
        text: "Avoid notification fatigue from transient spikes. Rules evaluate consecutive metric windows (e.g. CPU > 85% for 3 cycles) before triggering alert delivery.",
      },
    ],
  },
  {
    slug: "cli",
    title: "CLI",
    description: "The ninedeploy command — full scriptability.",
    group: "Interfaces",
    blocks: [
      {
        kind: "p",
        text: "The CLI communicates with the REST API using the typed SDK. User credentials live in ~/.ninedeploy/config.json (0600 permissions).",
      },
      {
        kind: "code",
        body: `ninedeploy setup                     # bootstrap first admin
ninedeploy login                     # authenticate interactively
ninedeploy services list             # list workspace services
ninedeploy services deploy my-app    # trigger a deploy
ninedeploy deploys watch my-app 7    # stream live build logs
ninedeploy deploys rollback my-app 7 # rollback to exact digest
ninedeploy env set my-app API_KEY …  # encrypted secret
ninedeploy domains add my-app app.example.com
ninedeploy backups create 3          # snapshot database #3
ninedeploy system dashboard          # open web dashboard`,
      },
    ],
  },
  {
    slug: "api",
    title: "REST API & SDK",
    description: "Unified /v1 API surface with TypeScript SDK.",
    group: "Interfaces",
    blocks: [
      {
        kind: "p",
        text: "All endpoints live under /v1 and take Authorization: Bearer <token> (except public health, webhook, and auth endpoints). Shared Zod schemas keep contracts synchronized.",
      },
      {
        kind: "code",
        body: `curl -X POST http://localhost:3000/v1/auth/login \\
  -d '{"email":"admin@example.com","password":"…"}'

curl -X POST http://localhost:3000/v1/services/1/deploys \\
  -H "Authorization: Bearer $TOKEN"

curl "http://localhost:3000/v1/services/1/metrics?kind=cpu&minutes=60" \\
  -H "Authorization: Bearer $TOKEN"`,
      },
      { kind: "h2", text: "TypeScript SDK" },
      {
        kind: "code",
        body: `import { createClient } from "@ninedeploy/sdk";

const nd = createClient({ baseUrl: "http://localhost:3000", token: "nd_…" });
const deploys = await nd.deploys.list(1);
await nd.deploys.trigger(1);`,
      },
      {
        kind: "p",
        text: "SDK namespaces: auth, services, deploys, domains, volumes, system, tunnels, activity, alerts, settings, users, projects, workspaces, about, notifications, sources, webhooks, databases, and plugins.",
      },
    ],
  },
  {
    slug: "mcp",
    title: "MCP server (AI Agents)",
    description: "26 Model Context Protocol tools for AI assistants.",
    group: "Interfaces",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy includes an official Model Context Protocol (MCP) stdio server. AI agents (Claude Desktop, Cursor, Antigravity, Cline) can query metrics, trigger deployments, inspect build logs, configure databases, and manage extensions.",
      },
      {
        kind: "code",
        file: "claude_desktop_config.json",
        body: `{
  "mcpServers": {
    "ninedeploy": {
      "command": "node",
      "args": ["/path/to/NineDeploy/packages/mcp/dist/index.js"],
      "env": {
        "NINEDEPLOY_URL": "http://127.0.0.1:3000",
        "NINEDEPLOY_TOKEN": "nd_…"
      }
    }
  }
}`,
      },
    ],
  },
  {
    slug: "microkernel",
    title: "Microkernel Architecture",
    description: "Event-driven, hookable, zero-coupling core engine.",
    group: "Extend",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy is architected around an asynchronous microkernel. Core services interact via an EventBus, waterfall hook pipelines, driver registries, and dual-vault config scopes.",
      },
      { kind: "h2", text: "Key Kernel Systems" },
      {
        kind: "list",
        items: [
          "EventBus: Low-latency async event pub/sub with typed events (deploy, audit, service, backup, alert).",
          "HookPipeline: Waterfall middleware (deploy.before, deploy.after, container.created) enabling plugins to intercept and mutate builds.",
          "ServiceRegistry: Dynamic driver interchange (Compute Drivers, Proxy Drivers, Storage Drivers).",
          "MenuRegistry: Dynamic UI navigation slot injection (sidebar items, service detail tabs, command palette actions).",
        ],
      },
    ],
  },
  {
    slug: "config-center",
    title: "Configuration Center",
    description: "Centralized dual-vault configuration and secret management.",
    group: "Extend",
    blocks: [
      {
        kind: "p",
        text: "Config Center provides a unified, reactive store for global server settings, system overrides, and plugin-scoped parameters.",
      },
      { kind: "h2", text: "Vault Separation & Encryption" },
      {
        kind: "list",
        items: [
          "Dual Vault: Plain text values (boolean, numbers, strings, JSON) vs AES-256-GCM encrypted secrets.",
          "Namespace Scoping: Unique plugin-scoped keys (e.g. plugin:s3-backups:bucket_name) with tag-based querying.",
          "Reactive Watchers: In-memory cache with zero DB lag and real-time onChange listeners for hot reloads.",
        ],
      },
    ],
  },
  {
    slug: "plugin-sdk",
    title: "Plugin SDK & Marketplace",
    description: "Build, publish, and install custom NineDeploy extensions.",
    group: "Extend",
    blocks: [
      {
        kind: "p",
        text: "Extend NineDeploy using @ninedeploy/plugin-sdk. Plugins can declare configuration schemas, register UI navigation items, tap into the deployment pipeline, and listen to security events.",
      },
      { kind: "h2", text: "Example Plugin" },
      {
        kind: "code",
        file: "my-plugin.ts",
        body: `import { definePlugin } from '@ninedeploy/plugin-sdk';

export default definePlugin({
  id: 'my-custom-extension',
  name: 'My Custom Extension',
  version: '1.0.0',
  configSchema: [
    { key: 'api_token', type: 'string', isSecret: true, label: 'API Token' }
  ],
  init: (ctx) => {
    ctx.hooks.tap('deploy.before', async (context) => {
      console.log('Deploying service:', context.serviceId);
      return context;
    });
  }
});`,
      },
      { kind: "h2", text: "Installing Extensions" },
      {
        kind: "p",
        text: "Install verified extensions from the web marketplace or CLI via `ninedeploy plugins install <id>`. Supports Marketplace, NPM packages, Git repos, and local directories.",
      },
    ],
  },
  {
    slug: "configuration",
    title: "Configuration",
    description: "Environment variables that matter.",
    group: "Reference",
    blocks: [
      {
        kind: "code",
        body: `NINEDEPLOY_PORT=3000              # dashboard + API port
NINEDEPLOY_DATA_DIR=./.data        # SQLite, repos, logs, backups
NINEDEPLOY_JWT_SECRET=…            # REQUIRED in production
NINEDEPLOY_MASTER_KEY=…            # AES-256 secrets key
NINEDEPLOY_MASTER_KEYS=0:old,1:new # key ring for rotation
NINEDEPLOY_WILDCARD_DOMAIN=…       # auto-assign {slug}.domain
NINEDEPLOY_DNS_PROVIDER=cloudflare # DNS-01 wildcard certs
NINEDEPLOY_DNS_TOKEN=…
NINEDEPLOY_DEPLOY_CONCURRENCY=1    # parallel worker slots (1-8)
NINEDEPLOY_TEMPLATES_SOURCE=…      # registry URL/path override
NINEDEPLOY_UPDATE_CHECK_URL=…      # or "disabled" for air-gapped`,
      },
      {
        kind: "callout",
        tone: "info",
        title: "Self-migrating",
        text: "Pending SQL migrations apply automatically on every startup — bare-metal and container alike. drizzle-kit is dev-only.",
      },
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting & Common Fixes",
    description: "Resolving common operational issues, Docker permissions, and boot errors.",
    group: "Reference",
    blocks: [
      { kind: "h2", text: "1. Production Boot: Insecure JWT Secret Error" },
      {
        kind: "p",
        text: "Symptom: The server exits immediately with 'Refusing to boot in production with default JWT secret'.",
      },
      {
        kind: "code",
        body: `# Fix: Generate a secure 256-bit random string and set NINEDEPLOY_JWT_SECRET in .env
openssl rand -hex 32
# Add to .env:
# NINEDEPLOY_JWT_SECRET=c9a0...3f2`,
      },
      { kind: "h2", text: "2. Docker Daemon Permission Denied" },
      {
        kind: "p",
        text: "Symptom: 'connect: permission denied' when communicating with /var/run/docker.sock.",
      },
      {
        kind: "code",
        body: `# Ensure the service user belongs to the 'docker' group:
sudo usermod -aG docker $USER
newgrp docker
# For Docker-in-Docker containers, verify the socket volume mount:
# -v /var/run/docker.sock:/var/run/docker.sock`,
      },
      { kind: "h2", text: "3. SQLite Database Locked or Busy" },
      {
        kind: "p",
        text: "Symptom: 'SQLITE_BUSY: database is locked'.",
      },
      {
        kind: "code",
        body: `# NineDeploy uses synchronous file locks. Ensure only one NineDeploy instance is accessing the .data directory.
# If a previous crashed process holds a lock, verify no zombie processes:
pgrep -fl ninedeploy
# Restart the systemd service cleanly:
sudo systemctl restart ninedeploy`,
      },
      { kind: "h2", text: "4. Port 80/443 Conflicts with Existing Nginx/Apache" },
      {
        kind: "p",
        text: "Symptom: Traefik container fails to bind port 80 or 443.",
      },
      {
        kind: "code",
        body: `# Check which process is occupying port 80/443:
sudo ss -tulpn | grep -E ':(80|443)'
# Stop or disable conflicting standalone web servers:
sudo systemctl stop nginx
sudo systemctl disable nginx`,
      },
      { kind: "h2", text: "5. Remote Node Agent Connection Refused" },
      {
        kind: "p",
        text: "Symptom: Controller reports 'Agent unreachable' when querying remote node.",
      },
      {
        kind: "code",
        body: `# Check that the agent is running on the remote host:
curl http://<remote-node-ip>:3001/health
# Verify firewall allows port 3001 from the controller IP:
sudo ufw allow from <controller-ip> to any port 3001 proto tcp`,
      },
    ],
  },
];

export const docGroups = [
  "Start",
  "Core",
  "Security",
  "Extend",
  "Interfaces",
  "Reference",
].map((name) => ({
  name,
  items: docs.filter((d) => d.group === name),
}));
