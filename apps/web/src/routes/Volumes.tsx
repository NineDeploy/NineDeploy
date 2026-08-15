import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Database, HardDrive, Layers, Lock, Package, Server, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, EmptyState, Input, Skeleton, cn } from '../components/ui.js';

function fmt(bytes: number): string {
  if (!bytes) return '—';
  const mb = bytes / 1024 ** 2;
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function Volumes() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useQuery({ queryKey: ['volumes'], queryFn: () => api.volumes.list() });
  const [confirmName, setConfirmName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (name: string) => api.volumes.remove(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['volumes'] });
      setPendingDelete(null);
      setConfirmName('');
      toast('Volume deleted', 'success');
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Delete failed', 'error'),
  });
  const total = (list.data ?? []).reduce((s, v) => s + v.sizeBytes, 0);
  const max = Math.max(1, ...(list.data ?? []).map((v) => v.sizeBytes));
  const retained = (list.data ?? []).filter((v) => !v.owner).length;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Layers size={20} className="text-indigo-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Volumes &amp; Storage</h1>
          <p className="text-sm text-slate-400">
            {(list.data?.length ?? 0)} volumes · {fmt(total)} used{retained > 0 ? ` · ${retained} retained` : ''}
          </p>
        </div>
      </div>

      <DockerResources />

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Persistent volumes</h2>
      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Card key={i} className="p-5"><Skeleton className="h-12 w-full" /></Card>)}
        </div>
      ) : !list.data || list.data.length === 0 ? (
        <Card><EmptyState icon={<HardDrive size={26} />} title="No volumes" hint="Deploy a service with a volume or create a database." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((v) => {
            const isRetained = !v.owner;
            return (
              <Card key={v.name} interactive className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('grid h-9 w-9 place-items-center rounded-xl ring-1 ring-inset ring-white/10', isRetained ? 'bg-amber-500/10 text-amber-300' : v.owner?.kind === 'database' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-indigo-500/10 text-indigo-300')}>
                      {isRetained ? <HardDrive size={16} /> : v.owner?.kind === 'database' ? <Database size={16} /> : <Server size={16} />}
                    </span>
                    <div>
                      <div className="font-medium leading-tight text-slate-100">{v.owner?.name ?? 'Retained'}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {isRetained ? 'no active owner' : `${v.owner!.kind}${v.owner!.engine ? ` · ${v.owner!.engine}` : ''}`}
                      </div>
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-200">{fmt(v.sizeBytes)}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className={cn('h-full rounded-full transition-all', isRetained ? 'bg-amber-500/70' : 'bg-indigo-500/70')} style={{ width: `${Math.max(3, (v.sizeBytes / max) * 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide', v.inUse ? 'bg-rose-500/10 text-rose-300' : isRetained ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/10 text-emerald-300/80')}>
                    {v.inUse ? 'in use · locked' : isRetained ? 'retained · reusable' : 'attached · stopped'}
                  </span>
                  {!v.inUse && (
                    <button
                      onClick={() => { setPendingDelete(v.name); setConfirmName(''); }}
                      className="text-slate-600 transition hover:text-rose-400"
                      title="Delete volume (destructive)"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {v.inUse && <span title={`Attached to a running ${v.owner?.kind ?? 'workload'} — stop it first`}><Lock size={13} className="text-slate-600" /></span>}
                </div>
                {pendingDelete === v.name && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); if (confirmName === v.name) remove.mutate(v.name); }}
                    className="mt-2 flex items-center gap-2"
                  >
                    <Input
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={`Type ${v.name} to delete`}
                      className="h-7 text-[11px]"
                      aria-label="Confirm volume name"
                    />
                    <Button type="submit" size="sm" variant="danger" className="h-7 px-2 text-[11px]" disabled={confirmName !== v.name || remove.isPending}>
                      {remove.isPending ? '…' : 'Delete'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setPendingDelete(null)}>Cancel</Button>
                  </form>
                )}
                <div className="mt-1 truncate font-mono text-[10px] text-slate-600">{v.name}</div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-600">
        Deleting a database keeps its volume (marked <span className="text-amber-400">retained</span>) so data survives — recreating the same database reuses it. Remove a volume here only to free disk. <Link to="/backups" className="text-indigo-400 hover:underline">Backups</Link>.
      </p>
    </div>
  );
}

function DockerResources() {
  const qc = useQueryClient();
  const res = useQuery({ queryKey: ['docker-resources'], queryFn: () => api.system.resources(), refetchInterval: 20000 });
  const prune = useMutation({
    mutationFn: () => api.system.pruneImages(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docker-resources'] }),
  });
  const s = res.data?.imagesSummary;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <Package size={15} className="text-slate-500" /> Docker resources
        </div>
        <Button size="sm" variant="secondary" onClick={() => prune.mutate()} disabled={prune.isPending}>
          <Trash2 size={13} /> Prune images
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Network" value={res.data?.network ?? '—'} />
        <Metric label="Containers" value={String(res.data?.containers ?? '—')} />
        <Metric label="Volumes" value={String(res.data?.volumes ?? '—')} />
        <Metric label="Images" value={s ? `${s.active}/${s.total} active` : '—'} />
      </div>
      {s && (
        <p className="mt-3 text-xs text-slate-500">
          Images use <span className="text-slate-300">{s.size}</span>{s.reclaimable && s.reclaimable !== '0B' ? ` · <span className="text-amber-400">${s.reclaimable}</span> reclaimable` : ''}.
        </p>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm text-slate-200">{value}</div>
    </div>
  );
}
