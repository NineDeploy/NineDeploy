import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Activity, ChevronRight, Cloud, Database, Globe, HardDrive,
  KeyRound, Layers, LogOut, Menu, Network, Server, Settings as SettingsIcon,
  Sparkles, Users, X,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth.js';
import { api } from '../lib/api.js';
import { BrandMark, cn } from './ui.js';

const NAV = [
  { to: '/hub', label: 'Hub', icon: Sparkles },
  { to: '/', label: 'Services', icon: Server, exact: true },
  { to: '/databases', label: 'Databases', icon: Database },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/tunnels', label: 'Tunnels', icon: Cloud },
  { to: '/volumes', label: 'Volumes', icon: Layers },
  { to: '/topology', label: 'Topology', icon: Network },
  { to: '/backups', label: 'Backups', icon: HardDrive },
  { to: '/sources', label: 'Sources', icon: KeyRound },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const EXPANDED_KEY = 'ninedeploy.sidebar.expanded';

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(EXPANDED_KEY) === 'true'; } catch { return false; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, String(expanded)); } catch { /* ignore */ }
  }, [expanded]);

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left rail ─────────────────────────────────────────── */}
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.015] backdrop-blur-sm transition-all duration-200',
          expanded ? 'w-56' : 'w-14',
        )}
      >
        {/* Logo */}
        <div className={cn('flex items-center gap-2.5 px-3 py-4', expanded ? '' : 'justify-center')}>
          <BrandMark size={expanded ? 30 : 26} />
          {expanded && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">NineDeploy</div>
              <div className="text-[9px] uppercase tracking-widest text-slate-600">Control Plane</div>
            </div>
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'mx-2 mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300',
            expanded ? '' : 'justify-center',
          )}
        >
          <Menu size={15} className={cn('transition-transform', expanded && 'rotate-90')} />
          {expanded && <span className="text-[10px] uppercase tracking-widest">Collapse</span>}
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {NAV.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={!expanded ? item.label : undefined}
                className={cn(
                  'group relative mb-0.5 flex items-center rounded-lg transition',
                  expanded ? 'gap-2.5 px-2.5 py-2' : 'justify-center px-0 py-2',
                  active
                    ? 'bg-indigo-500/15 text-white'
                    : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200',
                )}
              >
                {active && !expanded && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-indigo-400" />
                )}
                <Icon size={18} className={cn('shrink-0', active && 'text-indigo-400')} />
                {expanded && (
                  <span className={cn('text-sm', active ? 'font-medium' : '')}>{item.label}</span>
                )}
                {/* Tooltip for collapsed mode */}
                {!expanded && (
                  <span className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-white/[0.06] p-2">
          <div className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', expanded ? '' : 'justify-center')}>
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
              {(user?.email ?? '?')[0]?.toUpperCase()}
            </div>
            {expanded && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-xs font-medium text-slate-300">{user?.email}</div>
                <div className="text-[10px] capitalize text-slate-600">{user?.role}</div>
              </div>
            )}
            {expanded && (
              <button onClick={logout} className="text-slate-600 transition hover:text-rose-400" title="Sign out">
                <LogOut size={14} />
              </button>
            )}
          </div>
          {!expanded && (
            <button onClick={logout} className="mt-1 w-full rounded-lg py-1.5 text-center text-slate-600 transition hover:bg-white/[0.04] hover:text-rose-400" title="Sign out">
              <LogOut size={14} className="mx-auto" />
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="font-medium text-slate-300">NineDeploy</span>
            <ChevronRight size={13} className="text-slate-700" />
            <span className="capitalize">{NAV.find((n) => isActive(n))?.label ?? 'Dashboard'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              className="relative rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300"
              title="Activity"
            >
              <Activity size={16} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400" />
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

      {/* ── Right drawer (activity) ──────────────────────────── */}
      {drawerOpen && <ActivityDrawer onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

// ── Activity drawer ────────────────────────────────────────────────────────
function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.activity.list(),
    staleTime: 5000,
  });

  const fmtTime = (ts: string) => {
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const iconFor = (action: string) => {
    if (action.includes('deploy')) return '🚀';
    if (action.includes('rollback')) return '↩';
    if (action.includes('create')) return '✨';
    if (action.includes('delete')) return '🗑️';
    if (action.includes('stop')) return '⬛';
    if (action.includes('start')) return '▶';
    return '•';
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="nd-fade relative flex h-full w-80 flex-col border-l border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity size={15} className="text-indigo-400" /> Activity
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {activity.isLoading ? (
            <p className="py-4 text-center text-xs text-slate-600">Loading…</p>
          ) : !activity.data || activity.data.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-600">No recent activity.</p>
          ) : (
            <ul className="space-y-1">
              {activity.data.map((e) => (
                <li key={e.id} className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition hover:bg-white/[0.02]">
                  <span className="mt-0.5 text-sm">{iconFor(e.action)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-300">
                      {e.action.replace(/\./g, ' ')}
                      {e.entity && <span className="ml-1 font-normal text-slate-500">· {e.entity}</span>}
                    </div>
                    <div className="text-[10px] text-slate-600">{fmtTime(e.ts)}</div>
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
