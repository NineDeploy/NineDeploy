import { Link } from "react-router";
import {
  ArrowRight,
  Boxes,
  Database,
  GitBranch,
  Globe,
  KeyRound,
  LayoutGrid,
  Network,
  Rocket,
  RotateCcw,
  Server,
  ShieldCheck,
  Timer,
  Waypoints,
} from "lucide-react";
import { Terminal, type TermLine } from "../components/Terminal";
import { Marquee } from "../components/Marquee";

const heroLines: TermLine[] = [
  { text: "$ git push origin main", tone: "dim" },
  { text: "→ webhook verified (hmac-sha256) · branch=main · paths=[src/**]", tone: "accent" },
  { text: "→ deployment #47 queued", tone: "dim" },
  { text: "→ worker slot-1 claimed · building", tone: "warn" },
  { text: "→ clone ok · checkout 9f3c1ab · creds scrubbed", tone: "dim" },
  { text: "→ docker build ✓  · image nd-svc-api:9f3c1ab", tone: "ok" },
  { text: "→ blue-green: new container up on net ninedeploy", tone: "dim" },
  { text: "→ healthcheck 200 OK (container ip, 3/3)", tone: "ok" },
  { text: "→ traefik router flipped · old container retired", tone: "ok" },
  { text: "✓ live at https://api.acme.dev — 0s downtime", tone: "ok" },
];

const templates = [
  "n8n", "Grafana", "Jellyfin", "Plex", "Nextcloud", "WordPress", "Ghost",
  "Umami", "Gitea", "Pi-hole", "MinIO", "code-server", "Prometheus", "Loki",
  "Home Assistant", "Uptime Kuma", "Meilisearch", "Postiz",
];

const bento = [
  {
    icon: Timer,
    title: "Blue-green, zero downtime",
    body: "The new container is healthchecked before the old one retires. Failure? The previous version keeps serving — automatic rollback to the exact commit or pinned image digest.",
    tag: "deploys",
  },
  {
    icon: Database,
    title: "Managed databases",
    body: "PostgreSQL, MySQL, MariaDB, Redis, MongoDB — one click, encrypted credentials, connection strings auto-injected into attached services.",
    tag: "data",
  },
  {
    icon: Globe,
    title: "Wildcard HTTPS",
    body: "Traefik ingress with ACME DNS-01. One *.your-domain cert up front; {slug}.your-domain auto-assigned to every service.",
    tag: "network",
  },
  {
    icon: Network,
    title: "Multi-server agents",
    body: "Register remote hosts running the agent. Typed operations only — docker pull/build/run, git checkout — never raw shell over the wire.",
    tag: "fleet",
  },
  {
    icon: ShieldCheck,
    title: "Security-first core",
    body: "Argon2id, TOTP 2FA, AES-256-GCM secrets with key rotation, RBAC, audit log, brute-force lockout, rate limiting — all built in.",
    tag: "security",
  },
  {
    icon: Waypoints,
    title: "Everything observable",
    body: "Live CPU/mem per container, alert rules with sustained-breach windows, topology graph, WebSocket deploy logs, exec terminal.",
    tag: "ops",
  },
];

const steps = [
  {
    icon: Server,
    n: "01",
    title: "Install on your server",
    body: "One curl against install.sh. Node ≥ 22.13 + Docker is all it takes — the core runs under a hardened systemd unit with a watchdog.",
  },
  {
    icon: GitBranch,
    n: "02",
    title: "Connect a repo or image",
    body: "Git (PAT or SSH deploy key), a container image, a Compose stack, or one of 48 hub templates. Watch-path globs keep monorepos quiet.",
  },
  {
    icon: Rocket,
    n: "03",
    title: "Ship, watch, roll back",
    body: "Push to deploy. Stream the build live over WebSocket. One-click rollback pins the exact digest. Cancel mid-flight any time.",
  },
];

export function Home() {
  return (
    <>
      {/* ---------------- hero ---------------- */}
      <section className="grid-bg relative">
        <div className="mx-auto max-w-7xl px-4 pt-16 pb-20 md:pt-24 md:pb-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="tag bg-black text-white dark:bg-phosphor dark:text-void border-black dark:border-phosphor">
                self-hosted PaaS
              </span>
              <span className="tag">v0.1.0</span>
              <span className="tag">100% test coverage</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-bold leading-[0.95] tracking-tight">
              Ship like you
              <br />
              <span className="text-phosphor-dim">mean it.</span>
              <span className="inline-block w-4 h-10 md:h-14 ml-2 -mb-1 bg-ink dark:bg-phosphor animate-blink" />
            </h1>
            <p className="mt-6 max-w-lg text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
              NineDeploy wraps Docker, PM2 and Traefik behind one dashboard, one
              CLI and one MCP server. Zero-downtime deploys, managed databases,
              encrypted secrets — on{" "}
              <span className="font-mono text-base">your</span> hardware, in a
              single SQLite file.
            </p>
            <div className="mt-8 flex flex-wrap gap-4 items-center">
              <Link
                to="/docs/installation"
                className="font-mono font-bold border-2 border-ink bg-ink text-white dark:border-phosphor dark:bg-phosphor dark:text-void px-6 py-3 hover:-translate-y-0.5 transition-transform"
              >
                curl the installer <ArrowRight size={15} className="inline ml-1 -mt-0.5" />
              </Link>
              <Link
                to="/docs/introduction"
                className="font-mono border-2 border-edge dark:border-line px-6 py-3 hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor transition-colors"
              >
                read the docs
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-zinc-500">
              <span>✦ no vendor lock-in</span>
              <span>✦ no external DB</span>
              <span>✦ MIT licensed</span>
            </div>
          </div>
          <Terminal lines={heroLines} />
        </div>
      </section>

      <Marquee items={templates} />

      {/* ---------------- bento ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-20 md:py-28">
        <div className="mb-12 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="tag mb-3">what you get</div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
              A platform, not a puzzle.
            </h2>
          </div>
          <Link to="/features" className="link-underline font-mono text-sm">
            all features →
          </Link>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {bento.map((b) => (
            <article
              key={b.title}
              className="panel panel-hard p-6 hover:-translate-y-1 transition-transform group"
            >
              <div className="flex items-start justify-between">
                <b.icon
                  size={26}
                  className="text-ink dark:text-phosphor"
                  strokeWidth={1.75}
                />
                <span className="tag text-zinc-500">{b.tag}</span>
              </div>
              <h3 className="mt-4 text-lg font-bold">{b.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {b.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- pipeline steps ---------------- */}
      <section className="border-y-2 border-edge dark:border-line bg-ink dark:bg-panel text-zinc-300">
        <div className="mx-auto max-w-7xl px-4 py-20 md:py-28">
          <div className="tag mb-3 border-phosphor text-phosphor">three steps</div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
            From curl to production.
          </h2>
          <div className="mt-12 grid md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.n} className="relative border-l-2 border-line pl-6">
                <span className="absolute -left-[13px] top-0 grid place-items-center w-6 h-6 border-2 border-phosphor bg-ink font-mono text-[10px] text-phosphor">
                  {s.n.slice(1)}
                </span>
                <s.icon size={24} className="text-phosphor" strokeWidth={1.75} />
                <h3 className="mt-3 text-lg font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- stats ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 grid grid-cols-2 md:grid-cols-4 gap-5">
        {[
          { icon: LayoutGrid, k: "48", v: "verified templates" },
          { icon: Boxes, k: "26", v: "tables, one SQLite file" },
          { icon: RotateCcw, k: "0s", v: "downtime per release" },
          { icon: KeyRound, k: "AES-256", v: "sealed secrets + rotation" },
        ].map((s) => (
          <div key={s.v} className="panel p-5 text-center">
            <s.icon size={20} className="mx-auto text-phosphor-dim" />
            <div className="mt-2 text-3xl font-bold font-mono">{s.k}</div>
            <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 mt-1">
              {s.v}
            </div>
          </div>
        ))}
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="grid-bg border-t-2 border-edge dark:border-line">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Your server. Your rules.
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            One command, one admin account, one dashboard. Deploys in minutes.
          </p>
          <CodeBlockImpl />
        </div>
      </section>
    </>
  );
}

function CodeBlockImpl() {
  return (
    <div className="panel panel-hard mx-auto mt-8 max-w-2xl text-left overflow-x-auto px-5 py-4 font-mono text-sm">
      <div className="text-zinc-500">$</div>
      <div>
        <span className="text-phosphor-dim">curl</span> -fsSL https://raw.githubusercontent.com/NineDeploy/NineDeploy/main/install.sh{" "}
        <span className="text-amber-term">|</span> bash
      </div>
    </div>
  );
}
