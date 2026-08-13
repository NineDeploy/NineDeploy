import { useQuery } from '@tanstack/react-query';
import { Cpu, Database, HardDrive, Info, Network, Package, Server } from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, CardBody, Skeleton } from '../components/ui.js';

export function Settings() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.stats.snapshot(), staleTime: 10000 });
  const resources = useQuery({ queryKey: ['docker-resources'], queryFn: () => api.system.resources(), staleTime: 10000 });
  const host = stats.data?.host;
  const s = resources.data;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        <Info size={20} className="text-indigo-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-slate-400">System information &amp; resource overview.</p>
        </div>
      </div>

      {/* System info */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">System</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow icon={<Server size={14} />} label="NineDeploy" value="v0.0.0 · MIT" />
            <InfoRow icon={<Network size={14} />} label="Docker network" value={s?.network ?? 'ninedeploy'} />
            <InfoRow icon={<Cpu size={14} />} label="CPU cores" value={host ? String(host.cpuCores) : '—'} />
            <InfoRow icon={<HardDrive size={14} />} label="Containers" value={s ? String(s.containers) : '—'} />
            <InfoRow icon={<Package size={14} />} label="Volumes" value={s ? String(s.volumes) : '—'} />
            <InfoRow icon={<Database size={14} />} label="Images" value={s?.imagesSummary ? `${s.imagesSummary.active}/${s.imagesSummary.total} active` : '—'} />
          </div>
        </CardBody>
      </Card>

      {/* Host resources */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Host Resources</h2>
          {stats.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : host ? (
            <div className="space-y-3">
              <Bar label="Memory" pct={Math.round((host.memUsedBytes / host.memTotalBytes) * 100)} text={`${fmtB(host.memUsedBytes)} / ${fmtB(host.memTotalBytes)}`} />
              <Bar label="Disk" pct={Math.round((host.diskUsedBytes / host.diskTotalBytes) * 100)} text={`${fmtB(host.diskUsedBytes)} / ${fmtB(host.diskTotalBytes)}`} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Load average (1m)</span>
                <span className="font-mono text-slate-300">{host.load1.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Docker daemon not reachable.</p>
          )}
        </CardBody>
      </Card>

      {/* Image storage */}
      {s?.imagesSummary && (
        <Card className="mb-5">
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Image Storage</h2>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Images use <span className="font-medium text-slate-200">{s.imagesSummary.size}</span></span>
              {s.imagesSummary.reclaimable !== '0B' && (
                <span className="text-xs text-amber-400">{s.imagesSummary.reclaimable} reclaimable</span>
              )}
            </div>
            <button
              onClick={() => resources.refetch()}
              className="mt-3 text-xs text-indigo-400 hover:underline"
            >
              Refresh
            </button>
          </CardBody>
        </Card>
      )}

      {/* Quick links */}
      <Card>
        <CardBody>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick Links</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href="/v1/activity" className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">Activity log</a>
            <a href="/health" className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">Health check</a>
            <a href="https://github.com/ninedeploy/ninedeploy" target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">GitHub ↗</a>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span> {label}
      </span>
      <span className="font-mono text-xs text-slate-200">{value}</span>
    </div>
  );
}

function Bar({ label, pct, text }: { label: string; pct: number; text: string }) {
  const tone = pct > 85 ? 'bg-rose-500' : pct > 65 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-400">{pct}% · {text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function fmtB(b: number): string {
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(b / 1024 ** 2).toFixed(0)} MB`;
}
