import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Activity, BellRing, Cpu, Database, Gauge, HardDrive, MemoryStick, Server } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Button, Card, Input, Select, Skeleton, StatusBadge, cn } from '../components/ui.js';
import { Sparkline } from '../components/Sparkline.js';

const fmtBytes = (b: number | null | undefined) => {
  if (!b) return '—';
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(b / 1024 ** 2).toFixed(0)} MB`;
};

export function Monitoring() {
  const { user: me } = useAuth();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.stats.snapshot(), refetchInterval: 4000 });
  const host = stats.data?.host;
  const containers = stats.data?.containers ?? [];

  const memPct = host ? Math.round((host.memUsedBytes / host.memTotalBytes) * 100) : 0;
  const diskPct = host ? Math.round((host.diskUsedBytes / host.diskTotalBytes) * 100) : 0;

  return (
    <div className="nd-fade">
      <div className="mb-6 flex items-center gap-2">
        <Activity size={20} className="text-indigo-400" />
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
      </div>

      {/* Host overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Cpu size={16} />} label="CPU" value={host ? `${host.cpuCores} cores` : '—'} sub={host ? `load ${host.load1.toFixed(2)}` : ''} />
        <BarCard icon={<MemoryStick size={16} />} label="Memory" pct={memPct} text={host ? `${fmtBytes(host.memUsedBytes)} / ${fmtBytes(host.memTotalBytes)}` : '—'} />
        <BarCard icon={<HardDrive size={16} />} label="Disk" pct={diskPct} text={host ? `${fmtBytes(host.diskUsedBytes)} / ${fmtBytes(host.diskTotalBytes)}` : '—'} />
        <StatCard icon={<Gauge size={16} />} label="Workloads" value={`${containers.length}`} sub="containers running" />
      </div>

      {/* Containers */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Containers</h2>
      {stats.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-3 h-8 w-20" />
            </Card>
          ))}
        </div>
      ) : containers.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-500">No running workloads yet.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {containers.map((c) => (
            <ContainerCard key={`${c.kind}-${c.refId}`} c={c} />
          ))}
        </div>
      )}

      <AlertRulesCard isAdmin={me?.role === 'admin'} />
    </div>
  );
}

function AlertRulesCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['alerts'], queryFn: () => api.alerts.list() });
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<'cpu' | 'memory' | 'cert-expiry'>('cpu');
  const [operator, setOperator] = useState<'>' | '<'>('>');
  const [threshold, setThreshold] = useState('80');
  // cert-expiry is host-wide — the server rejects service-scoped rules for it.
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.services.list(), staleTime: 60_000 });
  const [serviceId, setServiceId] = useState('');
  const [windows, setWindows] = useState('2');

  const create = useMutation({
    mutationFn: () =>
      api.alerts.create({
        name: name.trim(),
        metric,
        operator,
        threshold: Number(threshold),
        serviceId: metric === 'cert-expiry' ? null : serviceId ? Number(serviceId) : null,
        durationWindows: Number(windows) || 1,
      }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.alerts.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const rulesList = rules.data ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && threshold) create.mutate();
  };

  return (
    <>
      <h2 className="mb-3 mt-8 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <BellRing size={14} /> Alert Rules
      </h2>
      <Card className="p-4">
        {rules.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rulesList.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            No alert rules yet — add one to get notified when a metric crosses a threshold.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2">Rule</th>
                <th className="pb-2">Condition</th>
                <th className="pb-2">Current</th>
                <th className="pb-2">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rulesList.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-2 font-medium">{r.name}</td>
                  <td className="py-2 font-mono text-xs text-slate-400">
                    {r.metric} {r.operator} {r.threshold}
                  </td>
                  <td className="py-2 tabular-nums text-slate-300">{r.lastValue ?? '—'}</td>
                  <td className="py-2">
                    <StatusBadge status={r.status === 'firing' ? 'error' : r.status === 'breaching' ? 'deploying' : 'running'} />
                  </td>
                  <td className="py-2 text-right">
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => remove.mutate(r.id)}>
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isAdmin && (
          <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="rule name" className="h-8 w-40 text-xs" />
            <Select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} className="h-8 w-32 text-xs">
              <option value="cpu">cpu %</option>
              <option value="memory">memory MiB</option>
              <option value="cert-expiry">cert-expiry days</option>
            </Select>
            <Select value={operator} onChange={(e) => setOperator(e.target.value as typeof operator)} className="h-8 w-16 text-xs">
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
            </Select>
            <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="threshold" className="h-8 w-20 font-mono text-xs" />
            <Select
              value={metric === 'cert-expiry' ? '' : serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              disabled={metric === 'cert-expiry'}
              className="h-8 w-36 text-xs"
              title={metric === 'cert-expiry' ? 'cert-expiry rules are host-wide' : 'Scope (empty = host-wide)'}
            >
              <option value="">host-wide</option>
              {(services.data ?? []).map((svc) => (
                <option key={svc.id} value={svc.id}>{svc.name}</option>
              ))}
            </Select>
            <Input
              value={windows}
              onChange={(e) => setWindows(e.target.value)}
              placeholder="windows"
              className="h-8 w-20 font-mono text-xs"
              title="Consecutive 30s samples before firing"
            />
            <Button type="submit" size="sm" variant="ghost" className="ml-auto h-8 px-3 text-xs" disabled={create.isPending}>
              {create.isPending ? '…' : 'Add rule'}
            </Button>
          </form>
        )}
      </Card>
    </>
  );
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <span className="text-slate-400">{icon}</span> {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

function BarCard({ icon, label, pct, text }: { icon: ReactNode; label: string; pct: number; text: string }) {
  const tone = pct > 85 ? 'bg-rose-500' : pct > 65 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <span className="text-slate-400">{icon}</span> {label}
      </div>
      <div className="mt-1.5 flex items-end justify-between">
        <span className="text-xl font-semibold tracking-tight">{pct}%</span>
        <span className="text-[11px] text-slate-500">{text}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </Card>
  );
}

function ContainerCard({ c }: { c: import('@ninedeploy/sdk').ContainerStat }) {
  const isService = c.kind === 'service';
  const card = (
    <Card interactive className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn('grid h-9 w-9 place-items-center rounded-xl ring-1 ring-inset ring-white/10', isService ? 'bg-indigo-500/10 text-indigo-300' : 'bg-emerald-500/10 text-emerald-300')}>
            {isService ? <Server size={16} /> : <Database size={16} />}
          </div>
          <div>
            <div className="font-semibold leading-tight">{c.refName}</div>
            <div className="font-mono text-[10px] text-slate-500">{c.engine ?? c.name}</div>
          </div>
        </div>
        <StatusBadge status="running" />
      </div>

      <div className="mt-4 flex items-end gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">CPU</div>
          <div className="text-2xl font-semibold tabular-nums">{c.cpuPct.toFixed(2)}<span className="ml-0.5 text-sm text-slate-500">%</span></div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Memory</div>
          <div className="text-lg font-medium tabular-nums text-slate-200">
            {c.memMb.toFixed(0)}<span className="ml-0.5 text-xs text-slate-500">MB</span>
            {c.memLimitMb > 0 && <span className="ml-1 text-xs text-slate-600">/ {c.memLimitMb}</span>}
          </div>
        </div>
        {isService && <div className="ml-auto"><ServiceSpark id={c.refId} /></div>}
      </div>

      <LimitsRow kind={c.kind} id={c.refId} />
    </Card>
  );
  // Service cards link to their detail page; the interactive affordance is real.
  return isService ? <Link to={`/services/${c.refId}`}>{card}</Link> : card;
}

function ServiceSpark({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['metrics', id, 'cpu'], queryFn: () => api.stats.metrics(id, { kind: 'cpu', minutes: 60 }), refetchInterval: 15000 });
  const pts = (q.data?.points ?? []).map((p) => p.value / 100);
  return <Sparkline points={pts} width={130} height={34} />;
}

function LimitsRow({ kind, id }: { kind: 'service' | 'database'; id: number }) {
  const qc = useQueryClient();
  const [cpu, setCpu] = useState('');
  const [mem, setMem] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const input = { cpuShares: cpu ? Number(cpu) : 0, memLimitMb: mem ? Number(mem) : 0 };
      return kind === 'service' ? api.limits.setService(id, input) : api.limits.setDatabase(id, input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stats'] }),
  });

  // local form submit
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  useEffect(() => {
    setCpu('');
    setMem('');
  }, [id]);

  return (
    <form onSubmit={onSubmit} className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">Limits</span>
      <Input value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="cpu shares" className="h-7 w-24 font-mono text-[11px]" />
      <Input value={mem} onChange={(e) => setMem(e.target.value)} placeholder="mem MB" className="h-7 w-20 font-mono text-[11px]" />
      <Button type="submit" size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[11px]" disabled={save.isPending}>
        {save.isPending ? '…' : 'Save'}
      </Button>
    </form>
  );
}
