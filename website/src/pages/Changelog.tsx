const releases = [
  {
    version: "0.3.2",
    date: "2026-08",
    status: "current",
    notes: [
      {
        t: "Honest Runtimes",
        items: [
          "Manifest Creator presets pinned Node 20, Python 3.12 and Go 1.22 — all three had lost upstream support months earlier; the defaults are now Node 24 (Active LTS), Python 3.14 and Go 1.27, plus Ruby, PHP, Java and Rust",
          "Every version NineDeploy suggests comes from one curated catalog instead of literals duplicated across the panel and the CLI, and the catalog records the date it was last reviewed so staleness is visible rather than silent",
          "The Version field is a picker showing each version's support status, with an escape hatch for anything else — end-of-life versions stay selectable, they just carry an advisory naming the recommended pin",
        ],
      },
      {
        t: "Manifest Build Sections",
        items: [
          "The manifest's build half (runtime, phases, build) is not applied at build time — the pipeline applies only routes, alerts and database. The docs and the panel now say so instead of implying a pin that never happens",
          "Every runtime pin the nixpacks.toml generator produced was broken: wrong nixpkgs attribute names for Go and Ruby, nonsense for any patch-level pin, and a package list that replaced the provider toolchain instead of extending it",
          "Pins now go only through the provider environment variables Nixpacks 1.41.0 actually reads, and one it cannot honour returns a specific warning rather than quietly building a different version",
        ],
      },
    ],
  },
  {
    version: "0.3.1",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Boot Fix For 0.3.0",
        items: [
          "0.3.0 could not start — every boot died with \"Cannot access 'NETWORK' before initialization\" and systemd restarted it forever",
          "Two engine modules imported each other while one evaluated the other's constant at module scope, so the entry graph decided whether it was initialised yet; the shared Docker names moved into a module that imports nothing",
          "A new test walks the server module graph and fails on any import cycle — a type checker cannot see a temporal dead zone, so this could only surface in production",
          "A failed readiness check now prints systemd status, the last 60 journal lines and the health port owner, and a crash-loop ends the wait immediately instead of sitting through the whole window",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Tags, Volumes & The .ninedeploy Manifest",
        items: [
          "Services tag into many projects, workspaces and labels at once, with a top-bar filter that composes all three",
          "Per-service volume attachments: mount any number of managed Docker volumes at explicit container paths",
          "Volume backups with retention pruning, off-site copies, and a restore that refuses to run under a live service",
          "`.ninedeploy` manifest with `manifest init/validate/show` — schema-checked and secret-scanned before it reaches git",
          "Private-repo deployment and auto-deploy webhooks from the CLI, plus workspace invitations for addresses without an account yet",
          "A new Organize menu puts Workspaces, Projects and the new Labels page in the navigation — projects had a route with no menu entry, and labels had no management screen at all",
          "Volume snapshots, restore and download from the Volumes page, including retained volumes that belong to no service",
        ],
      },
      {
        t: "Installer",
        items: [
          "The release channel installs the source tarball GitHub publishes for the tag instead of cloning — no git needed on the host, and no half-fetched shallow checkout",
          "The newest tag is resolved from git ls-remote, then the GitHub releases API, then the tags API, so one unavailable source cannot pin you to a stale version",
          "Build output and the turbo cache are cleared before every rebuild, and the installer verifies the built version against the requested tag — an upgrade can no longer keep serving the previous panel bundle",
          "New --force flag discards local modifications and rebuilds from scratch",
        ],
      },
      {
        t: "Upgrade & Correctness Fixes",
        items: [
          "Implemented the three managed-volume helpers the backup routes imported but that were never written — the server package did not build without them",
          "Finished the service tagging migration in the services API, which still read the removed single-project column",
          "Fixed an upgrade that blocked every install from 0.2.2 onward: a column added at boot collided with its own later migration and the panel would not start",
          "Restored 90 source files whose non-ASCII characters had been double-encoded, and the workspace role fields a bad rename had renamed away",
          "A label created from the top-bar filter no longer disappears the moment it is added",
          "Menu permissions fail closed: an operator-gated item is hidden, not shown, when the flag is absent",
        ],
      },
    ],
  },
  {
    version: "0.2.36",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Runtime Resilience & Hardening",
        items: [
          "Self-healing runtime state: stopped containers, dead PM2 daemons and pruned proxies are revived automatically",
          "Boot resilience — Docker enabled at boot, a systemd unit for bare-metal PM2 deployments, restart policies on Compose services",
          "Streaming AES-256-GCM database backups, so a large dump never has to fit in server memory",
          "Read-only MCP mode (`NINEDEPLOY_MCP_READONLY=1`) exposing a fail-closed inspection allowlist",
          "Tenant isolation across domain, metrics, topology, network and volume views",
        ],
      },
    ],
  },
  {
    version: "0.2.2",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Platform Hardening & Cross-Platform Stability",
        items: [
          "Cross-platform file URL normalization for @ninedeploy/mcp AI server",
          "Installer readiness healthcheck bash loop scoping hardening",
          "First-run admin setup and database transactional initialization improvements",
          "100% test coverage verification and zero-error pipeline across all 9 monorepo packages",
        ],
      },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "NPM Distribution & CLI Packaging",
        items: [
          "Published CLI package as `ninedeploy` to npm registry for instant npx execution",
          "Public packaging for @ninedeploy/sdk, @ninedeploy/schemas, @ninedeploy/plugin-sdk, and @ninedeploy/mcp",
          "Streamlined monorepo release automation and multi-package dependency publishing",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Workspaces & SSO",
        items: [
          "Multi-tenant workspace isolation with Owner / Admin / Member / Viewer RBAC",
          "OpenID Connect (OIDC) Single Sign-On (Google, GitHub, Okta, Keycloak)",
          "WebAuthn Passkeys hardware authentication & TOTP 2FA",
          "Zero-touch SSH remote server provisioning & auto-discovery",
        ],
      },
      {
        t: "Microkernel & Extensions",
        items: [
          "Microkernel event bus and waterfall hook pipeline (deploy.before / deploy.after)",
          "Central Configuration Center with Dual-Vault AES-256-GCM encryption",
          "Plugin SDK with MenuRegistry and ServiceRegistry driver interchange",
          "35-tool Model Context Protocol (MCP) server for AI assistants",
        ],
      },
      {
        t: "Databases & Operations",
        items: [
          "Extended managed engines: Postgres (pgvector), MySQL, MariaDB, Redis, Valkey, ClickHouse, Meilisearch, RabbitMQ, Mongo",
          "Live in-browser Container Filesystem Manager with drag & drop",
          "Sustained-breach alerting rules with Telegram, Discord, Slack, Ntfy, Webhook, SMTP",
          "Ephemeral PR preview staging environments and 1-click demo stack",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Dokploy-parity wave",
        items: [
          "Deploy cancellation at all pipeline stages",
          "Webhook watch paths & monorepo path filters",
          "Cron-scheduled jobs and container commands",
          "S3 off-site backup destinations with SigV4 client",
          "Compose service type with ndcmp- prefix",
          "Multi-server typed agent protocol",
          "Service export/import migration bundles",
          "Brute-force lockout & password reset flows",
        ],
      },
      {
        t: "UX & Engine",
        items: [
          "Command palette (Ctrl/Cmd+K)",
          "Real-time WebSocket build log streaming with replay",
          "Tabbed service detail with live container metrics",
          "Digest-pinned zero-downtime blue-green rollback",
          "systemd notify watchdog integration",
        ],
      },
    ],
  },
  {
    version: "0.0.x",
    date: "2026-07",
    status: "internal",
    notes: [
      {
        t: "Foundations",
        items: [
          "Fastify core + Zod schemas + typed SDK",
          "Blue-green Docker builder & PM2 process supervisor",
          "Traefik ingress + ACME HTTP-01 & DNS-01 wildcard certificates",
          "Managed databases + AES-256 encrypted backups",
          "Alerting, notifications, and immutable audit logs",
          "52-template app store with automatic secret provisioning",
        ],
      },
    ],
  },
];

export function Changelog() {
  return (
    <>
      <section className="grid-bg border-b-2 border-edge dark:border-line">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <div className="tag mb-3">git log --oneline</div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">Changelog</h1>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-4 py-14">
        {releases.map((r, ri) => (
          <div key={r.version} className="relative border-l-2 border-edge dark:border-line pl-8 pb-14">
            <span
              className={`absolute -left-[9px] top-1.5 w-4 h-4 border-2 border-ink dark:border-phosphor ${
                ri === 0 ? "bg-phosphor dark:bg-phosphor animate-pulse" : "bg-white dark:bg-panel"
              }`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold font-mono">v{r.version}</h2>
              <span className="tag">{r.status}</span>
              <span className="font-mono text-xs text-zinc-500">{r.date}</span>
            </div>
            <div className="mt-5 space-y-5">
              {r.notes.map((g) => (
                <div key={g.t} className="panel p-5">
                  <div className="font-mono text-xs uppercase tracking-widest text-phosphor-dim mb-2">
                    {g.t}
                  </div>
                  <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {g.items.map((it) => (
                      <li key={it} className="text-sm text-zinc-700 dark:text-zinc-300 flex gap-2">
                        <span className="text-phosphor-dim">+</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
