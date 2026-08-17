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
        text: "NineDeploy is a self-hosted deployment platform. It wraps PM2 and Docker behind a web dashboard, a CLI and an MCP server, fronts everything with Traefik, and handles webhooks, managed databases, monitoring, notifications and backups. All state lives in a single SQLite database on your server — no external dependencies.",
      },
      { kind: "h2", text: "The shape of the system" },
      {
        kind: "list",
        items: [
          "Core server (Fastify) runs bare-metal under systemd for direct Docker + PM2 access — a container image exists for Docker-based installs.",
          "Remote hosts run the same binary in agent mode (NINEDEPLOY_AGENT=1) and execute a fixed table of typed operations.",
          "All app containers live on a shared Docker network; only Traefik is exposed on :80/:443.",
          "The web dashboard is served by the API itself — one process, one port.",
        ],
      },
      { kind: "h2", text: "Design principles" },
      {
        kind: "list",
        items: [
          "No host ports on apps — healthchecks probe container IPs, Traefik routes by name.",
          "Every subprocess has a hard timeout with tree-kill; a hung build can never block the queue.",
          "Secrets are AES-256-GCM encrypted in versioned envelopes with a rotatable key ring.",
          "100% test coverage enforced in CI across every package — no ratchets.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Requirements",
        text: "Node ≥ 22.13, Docker, and a Linux host (or macOS for development). That's the whole list.",
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
        text: "The installer checks Node ≥ 22.13, clones the repo, renders a hardened systemd unit (Type=notify, WatchdogSec=90, ProtectSystem=strict) and enables the service. Open http://localhost:3000 and create the first admin.",
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
        text: "All state (SQLite, repos, logs, backups, master key) lives in the volume; migrations apply automatically on startup. PM2 services need bare-metal; Docker services and templates work in both modes.",
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
        text: "Re-running the installer performs an in-place upgrade: snapshot the DB, checkout the resolved version (latest release by default, --channel main for edge, --version to pin), rebuild, migrate, restart, gate on /health.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "JWT secret",
        text: "The server refuses to boot in production with the insecure default JWT secret. Generate one: openssl rand -hex 32.",
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
        text: "Deploys are rows in a database, claimed atomically by worker slots (NINEDEPLOY_DEPLOY_CONCURRENCY, default 1, max 8). The same service is never deployed concurrently. Deployments stranded mid-build by a restart are swept on boot.",
      },
      {
        kind: "list",
        items: [
          "Trigger: manual, webhook (HMAC + branch + watch-path globs + replay dedup), CLI, cron job, or template hub.",
          "Build: git clone with source credentials (scrubbed after checkout) or image pull with per-source registry auth.",
          "Blue-green: the new container starts on the shared network while the old one keeps serving.",
          "Healthcheck: container liveness plus an HTTP probe on the container's network IP — fresh per attempt, per-attempt timeout.",
          "Flip: Traefik's dynamic config is rewritten atomically; only then is the old container retired.",
          "Failure: the new runtime is torn down and the previous healthy version keeps serving.",
          "Cancel: the pipeline re-reads the deployment status between every stage and tears down partial work.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Rollback pins digests",
        text: "Each deployment records the exact image digest it ran. Rollback redeploys that precise image — never a moved :latest tag.",
      },
    ],
  },
  {
    slug: "databases",
    title: "Managed databases",
    description: "Postgres, MySQL, MariaDB, Redis, Mongo — plus backups.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "One-click databases with persistent volumes, CPU/memory limits, and credentials encrypted at rest. Attach a database to a service and a DATABASE_URL-style connection string is injected automatically at build and runtime.",
      },
      { kind: "h2", text: "Backups" },
      {
        kind: "list",
        items: [
          "pg_dump / mysqldump / mariadb-dump / mongodump / RDB snapshots, encrypted with the master key the moment they hit disk.",
          "Daily scheduled backups keep the last 7 per database; manual backups are never pruned.",
          "Off-site: any S3-compatible endpoint (AWS, MinIO, Cloudflare R2, B2) via the built-in SigV4 client — zero extra dependencies.",
          "Restore fetches the remote copy when the local file is gone; ownership-checked, tar-slip guarded.",
        ],
      },
    ],
  },
  {
    slug: "multi-server",
    title: "Multi-server",
    description: "Typed agent protocol across a fleet of hosts.",
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "Remote hosts run the same binary with NINEDEPLOY_AGENT=1. They boot a minimal HTTP agent instead of the full API and register against the core with a one-time token.",
      },
      {
        kind: "list",
        items: [
          "The core sends typed operation names — docker pull/build/run, compose up/down, git clone/checkout, env-file write — never a program name or raw argv.",
          "Every operand (names, paths, URLs) is validated by strict regexes on both ends.",
          "All process spawning funnels through one validated-spawn choke point.",
          "Services carry a serverId; the pipeline resolves it and the builder executes over the agent.",
          "Per-service export/import bundles move services between servers.",
        ],
      },
    ],
  },
  {
    slug: "cli",
    title: "CLI",
    description: "The ninedeploy command — everything scriptable.",
    group: "Interfaces",
    blocks: [
      {
        kind: "p",
        text: "The CLI talks to the same REST API via the typed SDK. Credentials live in ~/.ninedeploy/config.json (0600).",
      },
      {
        kind: "code",
        body: `ninedeploy setup                     # bootstrap first admin
ninedeploy login                     # authenticate
ninedeploy services list
ninedeploy services deploy my-app    # queue a deploy
ninedeploy deploys watch my-app 7    # stream live build logs
ninedeploy deploys rollback my-app 7
ninedeploy env set my-app API_KEY …  # secret by default
ninedeploy domains add my-app app.example.com
ninedeploy backups create 3
ninedeploy system dashboard`,
      },
    ],
  },
  {
    slug: "api",
    title: "REST API",
    description: "One /v1 surface behind every client.",
    group: "Interfaces",
    blocks: [
      {
        kind: "p",
        text: "All endpoints live under /v1 and take Authorization: Bearer <token> (except auth/setup/hooks/health). Zod schemas shared between server, web, CLI and SDK keep the contract honest.",
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
      { kind: "h2", text: "Typed SDK" },
      {
        kind: "code",
        body: `import { createClient } from "@ninedeploy/sdk";

const nd = createClient({ baseUrl: "http://localhost:3000", token: "nd_…" });
const deploys = await nd.deploys.list(1);
await nd.deploys.trigger(1);`,
      },
      {
        kind: "p",
        text: "Namespaces: auth, services, deploys, domains, volumes, system, tunnels, activity, alerts, settings, users, projects, about, notifications, sources, webhooks, databases — with an injectable fetch and NineDeployError.",
      },
    ],
  },
  {
    slug: "mcp",
    title: "MCP server",
    description: "Let your AI agent operate the instance.",
    group: "Interfaces",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy ships a Model Context Protocol server (stdio) with 26 tools over the same typed SDK: services, deploys, logs, domains, databases, projects, alerts, activity, stats, topology, health, plus plugins and central configuration management.",
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
    group: "Core",
    blocks: [
      {
        kind: "p",
        text: "NineDeploy is architected around an asynchronous microkernel. Core services (Docker, Traefik, S3, PM2) interact via an event bus, prioritized waterfall hook pipelines, driver registries, and dual-vault config scopes instead of direct tight coupling.",
      },
      { kind: "h2", text: "Key Kernel Systems" },
      {
        kind: "list",
        items: [
          "EventBus: Low-latency async event pub/sub with typed events (deploy, audit, service, backup).",
          "HookPipeline: Waterfall middleware pipeline (deploy.before, deploy.after, container.created) enabling plugins to modify build args or environment variables in-flight.",
          "ServiceRegistry: Dynamic driver interchange (Compute Drivers, Proxy Drivers, Storage Drivers).",
          "MenuRegistry: Dynamic UI navigation slot injection (sidebar, service tabs, command palette).",
        ],
      },
    ],
  },
  {
    slug: "config-center",
    title: "Configuration Center",
    description: "Centralized dual-vault configuration and secret management.",
    group: "Core",
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
];

export const docGroups = ["Start", "Core", "Extend", "Interfaces", "Reference"].map((name) => ({
  name,
  items: docs.filter((d) => d.group === name),
}));
