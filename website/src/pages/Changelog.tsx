const releases = [
  {
    version: "0.1.0",
    date: "2026-08",
    status: "pre-release",
    notes: [
      { t: "Dokploy-parity wave", items: ["Deploy cancel", "Webhook watch paths", "Cron-scheduled jobs", "S3 backup destinations", "TOTP 2FA", "Compose service type", "Multi-server agents", "Service migration bundles", "Password reset flow", "Release-channel installer"] },
      { t: "UX/API overhaul", items: ["Single-level projects", "Tabbed service detail", "Build-config PATCH", "Command palette", "6 accent themes"] },
      { t: "Hardening", items: ["Login lockout", "Update-check guard", "About guard", "systemd watchdog (sd_notify)"] },
    ],
  },
  {
    version: "0.0.x",
    date: "2026-07",
    status: "internal",
    notes: [
      { t: "Foundations", items: ["Fastify core + Zod schemas + typed SDK", "Blue-green Docker builder, PM2 builder", "Traefik ingress + wildcard DNS-01", "Managed databases + encrypted backups", "Alerting, notifications, audit log", "48-template hub with auto-secrets"] },
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
