import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Cloud, Database, Globe, HardDrive, KeyRound,
  Layers, LayoutDashboard, type LucideIcon, Network, Rocket, Search, Server,
  Settings as SettingsIcon, Sparkles, Users,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { cn } from './ui.js';

interface Cmd {
  type: string;
  label: string;
  sub: string;
  to: string;
  icon: LucideIcon;
}

const NAV_COMMANDS: Cmd[] = [
  { type: 'Navigate', label: 'Hub', sub: 'Template gallery', to: '/hub', icon: Sparkles },
  { type: 'Navigate', label: 'Dashboard', sub: 'Overview & health', to: '/dashboard', icon: LayoutDashboard },
  { type: 'Navigate', label: 'Services', sub: 'All services', to: '/services', icon: Server },
  { type: 'Navigate', label: 'Databases', sub: 'Managed databases', to: '/databases', icon: Database },
  { type: 'Navigate', label: 'Domains', sub: 'Domain routing & SSL', to: '/domains', icon: Globe },
  { type: 'Navigate', label: 'Tunnels', sub: 'Cloudflare tunnels', to: '/tunnels', icon: Cloud },
  { type: 'Navigate', label: 'Volumes', sub: 'Persistent storage', to: '/volumes', icon: Layers },
  { type: 'Navigate', label: 'Topology', sub: 'Service graph', to: '/topology', icon: Network },
  { type: 'Navigate', label: 'Backups', sub: 'Database snapshots', to: '/backups', icon: HardDrive },
  { type: 'Navigate', label: 'Sources', sub: 'Private repo credentials', to: '/sources', icon: KeyRound },
  { type: 'Navigate', label: 'Users', sub: 'Team management', to: '/users', icon: Users },
  { type: 'Navigate', label: 'Monitoring', sub: 'Resource metrics', to: '/monitoring', icon: Activity },
  { type: 'Navigate', label: 'Settings', sub: 'System info', to: '/settings', icon: SettingsIcon },
];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const services = useQuery({ queryKey: ['services'], queryFn: () => api.services.list() });
  const databases = useQuery({ queryKey: ['databases'], queryFn: () => api.databases.list() });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.templates.list() });

  const results = useMemo<Cmd[]>(() => {
    const dynamic: Cmd[] = [
      ...(services.data ?? []).map((s) => ({
        type: 'Service', label: s.name, sub: `${s.type} · ${s.status}`, to: `/services/${s.id}`, icon: Server,
      })),
      ...(databases.data ?? []).map((d) => ({
        type: 'Database', label: d.name, sub: `${d.engine} · ${d.status}`, to: '/databases', icon: Database,
      })),
      ...(templates.data ?? []).map((t) => ({
        type: 'Template', label: `Deploy ${t.name}`, sub: t.tagline, to: '/hub', icon: Sparkles,
      })),
    ];

    const all = [...NAV_COMMANDS, ...dynamic];
    if (!query.trim()) return all.slice(0, 8);
    const q = query.toLowerCase();
    return all
      .filter((c) => c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q) || c.type.toLowerCase().includes(q))
      .slice(0, 24);
  }, [query, services.data, databases.data, templates.data]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = results[selected]; if (r) { navigate(r.to); onClose(); } }
      else if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [results, selected, navigate, onClose]);

  const activate = (cmd: Cmd) => { navigate(cmd.to); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="nd-fade relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <Search size={18} className="shrink-0 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services, databases, templates, or jump to…"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />
          <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-500">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-auto p-2">
          {results.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-600">No results for "{query}"</p>
          ) : (
            results.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={`${cmd.type}-${cmd.label}-${i}`}
                  onClick={() => activate(cmd)}
                  onMouseEnter={() => setSelected(i)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                    i === selected ? 'bg-indigo-500/15' : 'hover:bg-white/[0.03]',
                  )}
                >
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', i === selected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/[0.04] text-slate-500')}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-200">{cmd.label}</div>
                    <div className="truncate text-xs text-slate-500">{cmd.sub}</div>
                  </div>
                  <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                    {cmd.type}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[10px] text-slate-600">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="rounded bg-white/[0.06] px-1 py-0.5">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="rounded bg-white/[0.06] px-1 py-0.5">↵</kbd> select</span>
          </div>
          <span className="flex items-center gap-1"><Rocket size={10} /> NineDeploy</span>
        </div>
      </div>
    </div>
  );
}
