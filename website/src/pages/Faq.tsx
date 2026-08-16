import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "How is this different from Dokploy / Coolify?",
    a: "NineDeploy is deliberately smaller and stricter: a single SQLite core (no external Postgres/Redis), 100% enforced test coverage, a typed-operation agent protocol instead of raw shell over the wire, and digest-pinned rollbacks. If you want a PaaS that reads like a well-audited codebase, this is it.",
  },
  {
    q: "Does it really need only SQLite?",
    a: "Yes. All state — users, services, deployments, metrics, backups metadata — lives in one .data directory with a single SQLite file. WAL is intentionally off so backup tarballs can safely copy the file.",
  },
  {
    q: "Can I run it in Docker?",
    a: "Yes — the published image mounts the host Docker socket with a /data volume. PM2-managed services need the bare-metal (systemd) install because they run on the host; Docker and Compose services and all 48 hub templates work in both modes.",
  },
  {
    q: "What about zero-downtime?",
    a: "Docker services deploy blue-green: the new container is healthchecked on the container network before Traefik flips routing, and the old container only retires after the flip. On failure the previous version keeps serving. PM2 services can't share a port, so they deploy stop-then-start with automatic rollback.",
  },
  {
    q: "How do multi-server agents stay safe?",
    a: "Agents expose a fixed table of typed operations (docker pull/build/run, compose up/down, git clone/checkout, env-file write). Requests never carry a program name or raw argv, every operand is regex-validated on both ends, and auth uses a shared token compared timing-safely as sha256.",
  },
  {
    q: "Is there an API for CI?",
    a: "Everything the dashboard does goes through the /v1 REST API with bearer tokens, a typed TypeScript SDK, a CLI, and an MCP server (15 tools) for AI assistants. Pick whichever fits your pipeline.",
  },
  {
    q: "What happens to my data on upgrade?",
    a: "The installer snapshots the SQLite file and master key to .data/upgrade-backups/ before touching anything, applies additive forward-only migrations, and gates the restart on /health. The systemd watchdog restarts the process if the event loop ever hangs.",
  },
];

export function Faq() {
  return (
    <>
      <section className="grid-bg border-b-2 border-edge dark:border-line">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <div className="tag mb-3">man nine deploy</div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">FAQ</h1>
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-4 py-14">
        <Accordion.Root type="single" collapsible className="border-2 border-edge dark:border-line">
          {faqs.map((f, i) => (
            <Accordion.Item
              key={f.q}
              value={f.q}
              className="border-b-2 border-edge dark:border-line last:border-b-0"
            >
              <Accordion.Header>
                <Accordion.Trigger className="group w-full flex items-center justify-between gap-4 px-5 py-4 text-left font-bold hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor transition-colors">
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-phosphor-dim shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {f.q}
                  </span>
                  <ChevronDown
                    size={16}
                    className="shrink-0 group-data-[state=open]:rotate-180 transition-transform"
                  />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="px-5 pb-5 pt-1 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {f.a}
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </section>
    </>
  );
}
