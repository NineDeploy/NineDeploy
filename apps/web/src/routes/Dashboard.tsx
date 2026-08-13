import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Database, Globe, Link2, Package, Rocket, Server, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { Card, CardBody, Skeleton, cn } from '../components/ui.js';

export function Dashboard() {
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard.get(), refetchInterval: 5000 });
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await api.services.importBundle(bundle);
      window.location.href = `/services/${res.serviceId}`;
    } catch {
      setImporting(false);
    }
  };

  if (dash.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const data = dash.data;
  if (!data) return null;
  const s = data.stats;
  const allHealthy = data.health.every((h) => h.healthy || h.status !== 'running');
  const unhealthyCount = data.health.filter((h) => !h.healthy && h.status === 'running').length;

  return (
    <div className="nd-fade space-y-5">
      {/* Hero status banner */}
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      <div className="mb-2 flex justify-end gap-2">
        <button onClick={() => importRef.current?.click()} disabled={importing}
          className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/[0.08] hover:text-slate-200 disabled:opacity-50">
          <Upload size={13} /> {importing ? 'Importing…' : 'Import service'}
        </button>
      </div>
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border p-5',
          allHealthy ? 'border-emerald-500/20 bg-emerald-500/[0.04]' : 'border-rose-500/20 bg-rose-500/[0.04]',
        )}
      >
        <div className="flex items-center gap-4">
          <div className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl', allHealthy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
            {allHealthy ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          </div>
          <div>
            <h1 className="text-lg font-semibold">
              {allHealthy ? 'All systems operational' : `${unhealthyCount} service${unhealthyCount > 1 ? 's' : ''} need attention`}
            </h1>
            <p className="text-sm text-slate-400">
              {s.running} running · {s.stopped} stopped · {s.errored} errored · {s.containers} containers · {s.dbRunning} databases
            </p>
          </div>
          <div className="ml-auto hidden items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1 text-xs text-slate-400 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live · refreshes every 5s
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={<Server size={15} />} label="Services" value={s.services} sub={`${s.running} running`} tone="indigo" />
        <StatCard icon={<Database size={15} />} label="Databases" value={s.databases} sub={`${s.dbRunning} running`} tone="emerald" />
        <StatCard icon={<Rocket size={15} />} label="Deploys" value={s.deployments} sub="total" tone="sky" />
        <StatCard icon={<Globe size={15} />} label="Domains" value={s.domains} sub="routed" tone="amber" />
        <StatCard icon={<Link2 size={15} />} label="Webhooks" value={s.webhooks} sub="active" tone="violet" />
        <StatCard icon={<Package size={15} />} label="Containers" value={s.containers} sub="docker" tone="slate" />
      </div>

      {/* Service health grid */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Service Health</h2>
        {data.health.length === 0 ? (
          <Card><CardBody><p className="py-6 text-center text-sm text-slate-500">No services yet. Deploy from the <Link to="/hub" className="text-indigo-400 hover:underline">Hub</Link>.</p></CardBody></Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.health.map((h) => {
              const isRunning = h.status === 'running';
              const isHealthy = h.healthy;
              return (
                <Link key={h.serviceId} to={`/services/${h.serviceId}`}>
                  <Card interactive className="group p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          'grid h-9 w-9 place-items-center rounded-lg ring-1 ring-inset transition',
                          isRunning && isHealthy ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20' :
                          isRunning && !isHealthy ? 'bg-rose-500/10 text-rose-300 ring-rose-500/20' :
                          h.status === 'stopped' ? 'bg-slate-500/10 text-slate-400 ring-slate-500/20' :
                          'bg-amber-500/10 text-amber-300 ring-amber-500/20',
                        )}>
                          {isRunning && isHealthy ? <CheckCircle2 size={17} /> :
                           isRunning && !isHealthy ? <XCircle size={17} /> :
                           h.status === 'stopped' ? <Server size={17} /> :
                           <AlertCircle size={17} />}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-200 group-hover:text-white">{h.name}</div>
                          <div className="font-mono text-[10px] text-slate-500">{h.type} · {h.commitSha ?? '—'}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        {h.responseMs != null && (
                          <div className={cn(
                            'font-mono text-xs font-medium',
                            h.responseMs < 100 ? 'text-emerald-300' : h.responseMs < 500 ? 'text-amber-300' : 'text-rose-300',
                          )}>
                            {h.responseMs}ms
                          </div>
                        )}
                        <div className={cn(
                          'text-[10px] font-medium uppercase',
                          isRunning && isHealthy ? 'text-emerald-400' :
                          isRunning && !isHealthy ? 'text-rose-400' :
                          h.status === 'stopped' ? 'text-slate-500' : 'text-amber-400',
                        )}>
                          {isRunning && isHealthy ? 'healthy' : isRunning && !isHealthy ? 'unhealthy' : h.status}
                        </div>
                      </div>
                    </div>
                    {/* Health bar */}
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          isRunning && isHealthy ? 'w-full bg-emerald-500' :
                          isRunning && !isHealthy ? 'w-1/4 bg-rose-500 animate-pulse' :
                          h.status === 'stopped' ? 'w-0' : 'w-1/2 bg-amber-500',
                        )}
                      />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent deployments */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent Activity</h2>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {data.recentDeploys.length === 0 ? (
                <tr><td className="px-5 py-6 text-center text-slate-500">No deployments yet.</td></tr>
              ) : (
                data.recentDeploys.map((d) => (
                  <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <Link to={`/services/${d.serviceId}`} className="font-medium text-slate-200 hover:text-indigo-300">{d.serviceName}</Link>
                      <span className="ml-2 font-mono text-[10px] text-slate-500">#{d.id} · {d.commitSha ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        d.status === 'running' ? 'bg-emerald-500/15 text-emerald-300' :
                        d.status === 'failed' ? 'bg-rose-500/15 text-rose-300' :
                        d.status === 'building' || d.status === 'queued' ? 'bg-amber-500/15 text-amber-300' :
                        'bg-slate-500/15 text-slate-400',
                      )}>{d.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right text-[10px] text-slate-600">
                      {d.finishedAt ? new Date(d.finishedAt).toLocaleString() : new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub: string; tone: string }) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-300 bg-indigo-500/10',
    emerald: 'text-emerald-300 bg-emerald-500/10',
    sky: 'text-sky-300 bg-sky-500/10',
    amber: 'text-amber-300 bg-amber-500/10',
    violet: 'text-violet-300 bg-violet-500/10',
    slate: 'text-slate-300 bg-slate-500/10',
  };
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <span className={cn('grid h-7 w-7 place-items-center rounded-lg', tones[tone]!)}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </Card>
  );
}
