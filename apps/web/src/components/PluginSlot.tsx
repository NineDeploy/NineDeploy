import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ExternalLink, Puzzle } from 'lucide-react';
import { api } from '../lib/api.js';

export interface PluginSlotProps {
  slot:
    | 'sidebar:main'
    | 'sidebar:secondary'
    | 'service:tabs'
    | 'database:tabs'
    | 'settings:nav'
    | 'command:palette'
    | 'user:menu'
    | 'dashboard:overview'
    | 'service:overview:widget'
    | 'monitoring:widgets'
    | string;
  className?: string;
}

export function PluginSlot({ slot, className = '' }: PluginSlotProps) {
  const menusQuery = useQuery({
    queryKey: ['menus', slot],
    queryFn: async () => {
      const res = await api.menus.list();
      const list = Array.isArray(res) ? res : (res as any)?.items ?? [];
      return list.filter((item: any) => item.slot === slot);
    },
    staleTime: 30000,
  });

  const items = menusQuery.data ?? [];

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={`plugin-slot plugin-slot-${slot.replace(/:/g, '-')} ${className}`}>
      {items.map((item: any) => {
        const isExternal = item.route?.startsWith('http://') || item.route?.startsWith('https://');

        return (
          <div
            key={item.id}
            className="flex items-center justify-between p-3.5 rounded-lg border border-slate-700/60 bg-slate-800/40 hover:bg-slate-800/80 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Puzzle size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                      {typeof item.badge === 'object' ? item.badge.text : item.badge}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                )}
              </div>
            </div>

            {item.route && (
              isExternal ? (
                <a
                  href={item.route}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Open <ExternalLink size={12} />
                </a>
              ) : (
                <Link
                  to={item.route}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  View
                </Link>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
