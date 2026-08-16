import { useQuery } from '@tanstack/react-query';
import { Container, Cpu, ImageIcon, Radio } from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, EmptyState, PageHeader, Skeleton } from '../components/ui.js';

function fmtEventTime(raw: string): string {
  const seconds = Number(raw);
  const date = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleTimeString();
}

/** Unified Docker dashboard: disk/images (system resources) + daemon event feed. */
export function DockerDashboard() {
  const resources = useQuery({
    queryKey: ['docker-resources'],
    queryFn: () => api.system.resources(),
    refetchInterval: 30000,
  });
  const events = useQuery({
    queryKey: ['docker-events'],
    queryFn: () => api.system.dockerEvents(60),
    refetchInterval: 20000,
  });

  const r = resources.data;

  return (
    <div>
      <PageHeader
        icon={<Container size={18} />}
        title="Docker Dashboard"
        subtitle="Host-level images, disk usage and the live daemon event feed"
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500"><Container size={13} /> Containers</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">{r ? r.containers : <Skeleton className="h-8 w-16" />}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500"><Cpu size={13} /> Volumes</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">{r ? r.volumes : <Skeleton className="h-8 w-16" />}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500"><ImageIcon size={13} /> Images</div>
          <div className="mt-2 text-2xl font-semibold text-slate-100">
            {r ? (
              <span>
                {r.imagesSummary.total}
                <span className="ml-2 text-sm font-normal text-slate-500">{r.imagesSummary.active} active · {r.imagesSummary.reclaimable} reclaimable</span>
              </span>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500"><Radio size={13} /> Shared network</div>
          <div className="mt-2 truncate font-mono text-lg text-slate-300">{r?.network ?? '—'}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Top images</h2>
          {!r || r.images.length === 0 ? (
            <p className="text-xs text-slate-600">No images.</p>
          ) : (
            <ul className="space-y-1">
              {r.images.slice(0, 15).map((img) => (
                <li key={`${img.repo}:${img.tag}`} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-xs ring-1 ring-inset ring-white/5">
                  <span className="min-w-0 truncate font-mono text-slate-300">
                    {img.repo}<span className="text-slate-600">:{img.tag}</span>
                  </span>
                  <span className="ml-3 shrink-0 text-slate-500">{img.size}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Daemon events (last hour)</h2>
          {events.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !events.data || events.data.events.length === 0 ? (
            <EmptyState icon={<Radio size={22} />} title="No recent events" hint="Auto-refreshes every 20s." />
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {events.data.events.map((e) => (
                <li key={`${e.time}-${e.type}-${e.action}-${e.name}`} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-1.5 font-mono text-[11px] ring-1 ring-inset ring-white/5">
                  <span className="min-w-0 truncate text-slate-400">
                    <span className="text-slate-600">{e.type}</span> <span className="text-indigo-300">{e.action}</span> {e.name}
                  </span>
                  <span className="ml-3 shrink-0 text-slate-600">{fmtEventTime(e.time)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
