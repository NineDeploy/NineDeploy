import type { ReactNode } from "react";
import { useState } from "react";
import { Link, NavLink } from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Menu,
  X,
  Sun,
  Moon,
  ChevronDown,
  ExternalLink,
  BookOpen,
  Zap,
  History,
  HelpCircle,
} from "lucide-react";
import { Logo } from "./Logo";
import { docs } from "../docs";

const docGroups = [
  { name: "Start", items: docs.filter((d) => d.group === "Start") },
  { name: "Core", items: docs.filter((d) => d.group === "Core") },
  { name: "Interfaces", items: docs.filter((d) => d.group === "Interfaces") },
  { name: "Reference", items: docs.filter((d) => d.group === "Reference") },
];

const simpleNav = [
  { to: "/features", label: "Features", icon: Zap },
  { to: "/changelog", label: "Changelog", icon: History },
  { to: "/faq", label: "FAQ", icon: HelpCircle },
];

export function Layout({
  children,
  theme,
  onToggleTheme,
}: {
  children: ReactNode;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors ${
      isActive
        ? "bg-ink text-white dark:bg-line dark:text-phosphor"
        : "hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b-2 border-edge dark:border-line bg-[var(--nd-bg)]/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 font-bold tracking-tight text-lg">
            <Logo className="w-9 h-9" />
            <span>
              nine<span className="text-phosphor-dim">deploy</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 ml-4 font-mono text-sm">
            {simpleNav.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                <item.icon size={14} /> {item.label}
              </NavLink>
            ))}

            {/* Docs: mega menu — grouped columns with descriptions + featured card */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="group px-3 py-1.5 inline-flex items-center gap-1.5 outline-none transition-colors hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor data-[state=open]:bg-ink data-[state=open]:text-white dark:data-[state=open]:bg-line dark:data-[state=open]:text-phosphor">
                <BookOpen size={14} /> Docs{" "}
                <ChevronDown size={13} className="transition-transform group-data-[state=open]:rotate-180" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  sideOffset={12}
                  align="start"
                  className="z-50 w-[min(46rem,calc(100vw-2rem))] border-2 border-edge dark:border-line bg-[var(--nd-panel)] p-4 shadow-[6px_6px_0_0_var(--nd-shadow)]"
                >
                  <div className="grid md:grid-cols-4 gap-4">
                    {docGroups.map((g) => (
                      <div key={g.name} className="min-w-0">
                        <div className="tag mb-2">{g.name}</div>
                        <div className="flex flex-col">
                          {g.items.map((d) => (
                            <DropdownMenu.Item key={d.slug} asChild>
                              <Link
                                to={`/docs/${d.slug}`}
                                className="rounded-none outline-none data-[highlighted]:bg-ink data-[highlighted]:text-white dark:data-[highlighted]:bg-line dark:data-[highlighted]:text-phosphor px-2 py-1.5 -mx-2 block"
                              >
                                <span className="font-mono text-sm font-bold block">{d.title}</span>
                                <span className="text-xs text-[#4a5c73] dark:text-zinc-400 block leading-snug">
                                  {d.description}
                                </span>
                              </Link>
                            </DropdownMenu.Item>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#dbe4ee] dark:border-line flex items-center justify-between gap-4">
                    <span className="font-mono text-xs text-[#4a5c73] dark:text-zinc-500">
                      9 pages · updated for v0.1.0
                    </span>
                    <DropdownMenu.Item asChild>
                      <Link
                        to="/docs/introduction"
                        className="font-mono text-xs font-bold border-2 border-ink bg-ink text-white dark:border-phosphor dark:bg-phosphor dark:text-void px-3 py-1.5 outline-none data-[highlighted]:opacity-80"
                      >
                        start reading →
                      </Link>
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/NineDeploy/NineDeploy"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:grid place-items-center w-9 h-9 border-2 border-edge dark:border-line hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor transition-colors"
              aria-label="GitHub"
            >
              <ExternalLink size={16} />
            </a>
            <button
              type="button"
              onClick={onToggleTheme}
              className="grid place-items-center w-9 h-9 border-2 border-edge dark:border-line hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Link
              to="/docs/installation"
              className="hidden md:inline-block font-mono text-sm font-bold border-2 border-ink bg-ink text-white dark:border-phosphor dark:bg-phosphor dark:text-void px-4 py-1.5 hover:-translate-y-0.5 transition-transform"
            >
              $ install
            </Link>
            <button
              type="button"
              className="md:hidden grid place-items-center w-9 h-9 border-2 border-edge dark:border-line"
              onClick={() => setOpen(!open)}
              aria-label="Menu"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="md:hidden border-t-2 border-edge dark:border-line bg-[var(--nd-panel)] px-4 py-3 flex flex-col gap-1 font-mono text-sm">
            <Link
              to="/docs/introduction"
              onClick={() => setOpen(false)}
              className="px-3 py-2 flex items-center gap-2 hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor"
            >
              <BookOpen size={14} /> Docs
            </Link>
            {simpleNav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="px-3 py-2 flex items-center gap-2 hover:bg-ink hover:text-white dark:hover:bg-line dark:hover:text-phosphor"
              >
                <item.icon size={14} /> {item.label}
              </Link>
            ))}
            <Link
              to="/docs/installation"
              onClick={() => setOpen(false)}
              className="mt-1 text-center font-bold border-2 border-ink bg-ink text-white dark:border-phosphor dark:bg-phosphor dark:text-void px-4 py-2"
            >
              $ install
            </Link>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t-2 border-edge dark:border-line bg-[var(--nd-panel)]">
        <div className="mx-auto max-w-7xl px-4 py-12 grid gap-10 md:grid-cols-4 font-mono text-sm">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 font-sans font-bold text-base">
              <Logo className="w-7 h-7" />
              nine<span className="text-phosphor-dim -ml-1">deploy</span>
            </div>
            <p className="text-[#4a5c73] dark:text-zinc-400 leading-relaxed">
              Self-hosted deploys with terminal-grade power. Your server, your
              containers, your data.
            </p>
            <div className="tag">MIT license</div>
          </div>
          <div>
            <div className="tag mb-3">product</div>
            <ul className="space-y-2 text-[#4a5c73] dark:text-zinc-400">
              <li><Link className="link-underline" to="/features">Features</Link></li>
              <li><Link className="link-underline" to="/changelog">Changelog</Link></li>
              <li><Link className="link-underline" to="/faq">FAQ</Link></li>
              <li><a className="link-underline" href="https://github.com/NineDeploy/NineDeploy">GitHub</a></li>
            </ul>
          </div>
          <div>
            <div className="tag mb-3">docs</div>
            <ul className="space-y-2 text-[#4a5c73] dark:text-zinc-400">
              <li><Link className="link-underline" to="/docs/installation">Installation</Link></li>
              <li><Link className="link-underline" to="/docs/deploy-pipeline">Deploy pipeline</Link></li>
              <li><Link className="link-underline" to="/docs/api">API</Link></li>
              <li><Link className="link-underline" to="/docs/mcp">MCP server</Link></li>
            </ul>
          </div>
          <div>
            <div className="tag mb-3">status</div>
            <ul className="space-y-2 text-[#4a5c73] dark:text-zinc-400">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 bg-phosphor-dim animate-pulse" /> v0.1.0 pre-release
              </li>
              <li>2,100+ tests · 100% coverage</li>
              <li>26 tables · SQLite core</li>
              <li>48 verified templates</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#dbe4ee] dark:border-line/60 py-4 text-center font-mono text-xs text-[#4a5c73] dark:text-zinc-500">
          exit 0 — built with an unhealthy love of terminals
        </div>
      </footer>
    </div>
  );
}
