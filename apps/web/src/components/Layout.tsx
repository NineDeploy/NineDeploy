import { useEffect, useState } from 'react';
import {
  Activity, ChevronLeft, Cloud, Database, FolderKanban, Globe, HardDrive,
  Info, KeyRound, Layers, LayoutDashboard, Moon, Network, type LucideIcon,
  Rocket, Search, Server, Settings as SettingsIcon, Sparkles, Sun, Users, X,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth.js';
import { getToken } from '../lib/api.js';
import { useProjectScope } from '../lib/projects.js';
import { useTheme } from '../lib/theme.js';
import { Logo } from './Logo.js';
import { cn } from './ui.js';
import { CommandPalette } from './CommandPalette.js';

interface NavItem { to: string; label: string; icon: LucideIcon }

interface NavGroup { id: string; label: string; icon: LucideIcon; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    id: 'deploy', label: 'Deploy', icon: Rocket, items: [
      { to: '/hub', label: 'Hub', icon: Sparkles },
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/services', label: 'Services', icon: Server },
    ],
  },
  {
    id: 'data', label: 'Data', icon: Database, items: [
      { to: '/databases', label: 'Databases', icon: Database },
      { to: '/volumes', label: 'Volumes', icon: Layers },
      { to: '/backups', label: 'Backups', icon: HardDrive },
    ],
  },
  {
    id: 'network', label: 'Network', icon: Globe, items: [
      { to: '/domains', label: 'Domains', icon: Globe },
      { to: '/tunnels', label: 'Tunnels', icon: Cloud },
      { to: '/topology', label: 'Topology', icon: Network },
    ],
  },
  {
    id: 'system', label: 'System', icon: SettingsIcon, items: [
      { to: '/monitoring', label: 'Monitoring', icon: Activity },
      { to: '/sources', label: 'Sources', icon: KeyRound },
      { to: '/servers', label: 'Servers', icon: HardDrive },
      { to: '/users', label: 'Users', icon: Users },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/about', label: 'About', icon: Info },
    ],
  },
];

function matchItem(item: NavItem, pathname: string): boolean {
  // '/services' must not light up on '/services/new' for a DIFFERENT item —
  // prefix matching is fine because group items have distinct prefixes.
  return pathname.startsWith(item.to);
}

function findGroup(pathname: string): string | null {
  for (const g of GROUPS) {
    if (g.items.some((i) => matchItem(i, pathname))) return g.id;
  }
  return null;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [activeGroup, setActiveGroup] = useState<string | null>(() => findGroup(location.pathname));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd+K / Ctrl+K to toggle command palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-open the correct group when navigating.
  useEffect(() => {
    const g = findGroup(location.pathname);
    if (g) setActiveGroup(g);
  }, [location.pathname]);

  const currentGroup = GROUPS.find((g) => g.id === activeGroup) ?? null;

  const toggleGroup = (id: string) => setActiveGroup((prev) => (prev === id ? null : id));

  const currentItem = currentGroup?.items.find((i) => matchItem(i, location.pathname));
  const pageTitle = currentItem?.label ?? 'Dashboard';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Activity Bar (far-left rail) ──────────────────── */}
      <div className="flex w-12 shrink-0 flex-col items-center border-r border-white/[0.06] bg-slate-950/70 py-3 backdrop-blur">
        {/* Brand mark */}
        <div className="mb-3 grid h-8 w-8 place-items-center">
          <Logo className="h-8 w-8" />
        </div>

        {/* Group icons */}
        {GROUPS.map((g) => {
          const Icon = g.icon;
          const active = activeGroup === g.id;
          return (
            <button type="button"
              key={g.id}
              onClick={() => toggleGroup(g.id)}
              className={cn(
                'group relative mb-1 grid h-10 w-10 place-items-center rounded-xl transition',
                active ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-500/30'
                  : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200',
              )}
            >
              <Icon size={19} />
              {/* Active indicator */}
              {active && <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400" />}
              {/* Tooltip */}
              <span className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {g.label}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* User avatar */}
        <button type="button"
          onClick={logout}
          className="group relative grid h-9 w-9 place-items-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30 transition hover:bg-rose-500/20 hover:text-rose-300"
          title="Sign out"
        >
          {(user?.email ?? '?')[0]?.toUpperCase()}
          <span className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {user?.email} · Sign out
          </span>
        </button>
      </div>

      {/* ── Secondary Panel (group items) ────────────────── */}
      {currentGroup && (
        <div className="nd-flex nd-fade flex w-52 shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.015] backdrop-blur-sm">
          {/* Group header */}
          <div className="flex items-center gap-2 px-4 pb-2 pt-4">
            <currentGroup.icon size={14} className="text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{currentGroup.label}</span>
          </div>

          {/* Items */}
          <nav className="flex-1 overflow-y-auto px-2 py-1">
            {currentGroup.items.map((item) => {
              const active = matchItem(item, location.pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
                    active ? 'bg-indigo-500/15 font-medium text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                  )}
                >
                  <Icon size={16} className={active ? 'text-indigo-400' : 'text-slate-500'} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Collapse button */}
          <button type="button"
            onClick={() => setActiveGroup(null)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-slate-600 transition hover:text-slate-400"
          >
            <ChevronLeft size={13} /> Collapse
          </button>
        </div>
      )}

      {/* ── Main ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
          <div className="flex items-center gap-2 text-sm">
            <ProjectSwitcher />
            <span className="font-medium text-slate-300">{currentGroup?.label ?? 'NineDeploy'}</span>
            {currentItem && (
              <>
                <span className="text-slate-700">/</span>
                <span className="text-slate-500">{pageTitle}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button"
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300"
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-white/[0.08] hover:text-slate-300"
              title="Search (⌘K)"
            >
              <Search size={13} />
              <span className="hidden sm:inline">Search</span>
              <kbd className="rounded bg-white/[0.06] px-1 py-0.5 text-[9px]">⌘K</kbd>
            </button>
            <button type="button"
              onClick={() => setDrawerOpen(true)}
              className="relative rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300"
              title="Activity"
            >
              <Activity size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="nd-fade flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-5 py-7 md:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ── Right drawer (activity) ──────────────────────── */}
      {drawerOpen && <ActivityDrawer onClose={() => setDrawerOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

// ── Global project switcher (top bar) ─────────────────────────────────────
function ProjectSwitcher() {
  const { projects, selectedId, select } = useProjectScope();
  return (
    <label className="relative flex items-center" title="Scope pages to a project">
      <FolderKanban size={13} className="pointer-events-none absolute left-2 text-slate-500" />
      <select
        aria-label="Project scope"
        value={selectedId ?? ''}
        onChange={(e) => select(e.target.value === '' ? null : Number(e.target.value))}
        className="h-7 appearance-none rounded-lg bg-white/[0.04] pl-7 pr-6 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Activity drawer (live WebSocket events) ───────────────────────────────
interface AppEvent { id: number; action: string; entity: string | null; ts: string }

function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/v1/events?token=${getToken() ?? ''}`);
    ws.onmessage = (e) => {
      try {
        const lines = String(e.data).split('\n').filter(Boolean);
        const parsed = lines.map((l) => JSON.parse(l) as AppEvent);
        setEvents((prev) => [...parsed, ...prev].slice(0, 100));
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, []);

  const filtered = filter === 'all' ? events : events.filter((e) => e.action.startsWith(filter));

  const fmtTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(ts).toLocaleTimeString();
  };

  const ICONS: Record<string, string> = {
    'service': '🖥️', 'database': '🗄️', 'domain': '🌐', 'deploy': '🚀', 'rollback': '↩️',
    'backup': '💾', 'tunnel': '☁️', 'source': '🔑', 'user': '👤', 'template': '✨',
    'volume': '💾', 'env': '🔐', 'webhook': '🔗',
  };
  const COLORS: Record<string, string> = {
    'service': 'text-indigo-300', 'database': 'text-emerald-300', 'domain': 'text-sky-300',
    'deploy': 'text-indigo-300', 'rollback': 'text-amber-300', 'backup': 'text-sky-300',
    'delete': 'text-rose-300', 'create': 'text-emerald-300',
  };
  const iconFor = (action: string) => {
    const prefix = action.split('.')[0]!;
    return ICONS[prefix] ?? '•';
  };
  const colorFor = (action: string) => {
    if (action.includes('delete')) return COLORS['delete']!;
    if (action.includes('create')) return COLORS['create']!;
    const prefix = action.split('.')[0]!;
    return COLORS[prefix] ?? 'text-slate-300';
  };

  const filters = ['all', 'service', 'database', 'domain', 'deploy', 'backup', 'user'];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close events drawer" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="nd-fade relative flex h-full w-80 flex-col border-l border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity size={15} className="text-indigo-400" /> Events
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300">● live</span>
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
        {/* Filter chips */}
        <div className="flex gap-1 overflow-x-auto border-b border-white/5 px-3 py-2">
          {filters.map((f) => (
            <button type="button"
              key={f}
              onClick={() => setFilter(f)}
              className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition capitalize', filter === f ? 'bg-indigo-500 text-white' : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.08]')}
            >
              {f}
            </button>
          ))}
        </div>
        {/* Events */}
        <div className="flex-1 overflow-auto p-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-600">No events yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((e) => (
                <li key={e.id} className="nd-fade flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]">
                  <span className="mt-0.5 text-sm">{iconFor(e.action)}</span>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-xs font-medium', colorFor(e.action))}>
                      {e.action.replace(/\./g, ' ')}
                    </div>
                    {e.entity && <div className="truncate text-[11px] text-slate-500">{e.entity}</div>}
                    <div className="text-[9px] text-slate-600">{fmtTime(e.ts)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
