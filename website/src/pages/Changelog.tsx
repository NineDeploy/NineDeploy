const releases = [
  {
    version: "0.2.1",
    date: "2026-08",
    status: "current",
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
