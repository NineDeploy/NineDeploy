import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowLeft, Check, Clock, Copy, Cpu, Download, ExternalLink, GitBranch, Globe,
  HardDrive, MemoryStick, Play, Plus, Rocket, RotateCcw, Settings, Square, Terminal, Trash2, Webhook, X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, getToken } from '../lib/api.js';
import { useDeployLogs } from '../lib/useDeployLogs.js';
import { AttachmentsCard } from '../components/AttachmentsCard.js';
import { ContainerTerminal } from '../components/ContainerTerminal.js';
import { EnvCard } from '../components/EnvCard.js';
import { Sparkline } from '../components/Sparkline.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, CardBody, Field, Input, Select, Skeleton, Spinner, StatusBadge, Tabs, cn } from '../components/ui.js';

const IN_FLIGHT = ['queued', 'building', 'deploying'];

type TabId = 'overview' | 'settings' | 'network' | 'config' | 'activity';

export function ServiceDetail() {
  const params = useParams();
  const id = Number(params['id']);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeDeploy, setActiveDeploy] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const navigate = useNavigate();

  const service = useQuery({
    queryKey: ['service', id],
    queryFn: () => api.services.get(id),
    refetchInterval: (q) => (q.state.data?.status === 'deploying' ? 2000 : false),
  });
  const deploys = useQuery({
    queryKey: ['deploys', id],
    queryFn: () => api.deploys.list(id),
    refetchInterval: (q) => (q.state.data?.some((d) => IN_FLIGHT.includes(d.status)) ? 2000 : false),
  });

  useEffect(() => {
    if (activeDeploy != null) return;
    const latest = deploys.data?.[0];
    if (latest) setActiveDeploy(latest.id);
  }, [deploys.data, activeDeploy]);

  const trigger = useMutation({
    mutationFn: () => api.deploys.trigger(id),
    onSuccess: (res) => {
      setActiveDeploy(res.deploymentId);
      setTab('overview');
      qc.invalidateQueries({ queryKey: ['deploys', id] });
      qc.invalidateQueries({ queryKey: ['service', id] });
    },
  });

  const lifecycle = useMutation({
    mutationFn: (action: 'stop' | 'start' | 'restart') => api.services[action](id),
    onSuccess: (_d, action) => {
      qc.invalidateQueries({ queryKey: ['service', id] });
      toast(`Service ${action}ed`, 'success');
    },
    onError: () => toast('Action failed', 'error'),
  });

  const rollback = useMutation({
    mutationFn: (depId: number) => api.deploys.rollback(id, depId),
    onSuccess: (res) => {
      setActiveDeploy(res.deploymentId);
      qc.invalidateQueries({ queryKey: ['deploys', id] });
      qc.invalidateQueries({ queryKey: ['service', id] });
      toast('Rollback started', 'info');
    },
    onError: () => toast('Rollback failed', 'error'),
  });

  const cancelDeploy = useMutation({
    mutationFn: (depId: number) => api.deploys.cancel(id, depId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deploys', id] });
      toast('Deployment cancelled', 'info');
    },
    onError: () => toast('Cancel failed', 'error'),
  });

  // Danger zone: delete the service (type-the-name confirm).
  const [confirmDelete, setConfirmDelete] = useState('');
  const removeService = useMutation({
    mutationFn: () => api.services.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Service deleted', 'success');
      navigate('/services');
    },
    onError: () => toast('Delete failed', 'error'),
  });

  const [showRuntimeLogs, setShowRuntimeLogs] = useState(false);
  const [showExec, setShowExec] = useState(false);

  const doExportService = async () => {
    try {
      toast('Exporting service…', 'info');
      const res = await fetch(api.services.exportUrl(id), { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${svc?.slug ?? 'service'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Service exported', 'success');
    } catch {
      toast('Export failed', 'error');
    }
  };
  const runtimeLogs = useQuery({
    queryKey: ['runtime-logs', id],
    queryFn: () => api.services.logs(id),
    enabled: showRuntimeLogs && !!service.data?.runtimeId,
    refetchInterval: showRuntimeLogs ? 3000 : false,
  });

  const svc = service.data;
  const activeDeployRow = deploys.data?.find((d) => d.id === activeDeploy) ?? null;
  const inFlight = !!activeDeployRow && IN_FLIGHT.includes(activeDeployRow.status);

  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const cur = activeDeployRow?.status ?? null;
    const wasInFlight = lastStatus.current != null && IN_FLIGHT.includes(lastStatus.current);
    const nowTerminal = cur != null && !IN_FLIGHT.includes(cur);
    if (wasInFlight && nowTerminal) qc.invalidateQueries({ queryKey: ['service', id] });
    lastStatus.current = cur;
  }, [activeDeployRow?.status, qc, id]);

  if (service.isError) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-rose-300">Couldn't load this service.</p>
        <p className="mt-1 text-xs text-slate-500">It may have been deleted, or the server is unreachable.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => service.refetch()}>Retry</Button>
          <Link to="/services"><Button size="sm" variant="ghost">Back to services</Button></Link>
        </div>
      </Card>
    );
  }

  if (service.isLoading || !svc) {
    return (
      <Card className="p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-3 h-4 w-2/3" />
      </Card>
    );
  }

  return (
    <div className="nd-fade">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200">
        <ArrowLeft size={14} /> Services
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{svc.name}</h1>
            <StatusBadge status={svc.status} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
            <span className="uppercase tracking-wide text-slate-400">{svc.type}</span>
            <span className="flex items-center gap-1">
              <GitBranch size={12} /> {svc.branch}
            </span>
            {svc.port && <span>: {svc.port}</span>}
            <span className="truncate">{svc.repoUrl ?? svc.image}</span>
          </p>
          {svc.autoUrl && (
            <a
              href={`http://${svc.autoUrl}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/20 transition hover:bg-emerald-500/15"
            >
              <ExternalLink size={12} /> {svc.autoUrl}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => trigger.mutate()} disabled={trigger.isPending}>
            <Rocket size={16} /> {trigger.isPending ? 'Triggering…' : 'Deploy'}
          </Button>
          {svc.status === 'running' && (
            <>
              <Button variant="secondary" size="md" onClick={() => lifecycle.mutate('restart')} disabled={lifecycle.isPending} title="Restart">
                <RotateCcw size={15} /> Restart
              </Button>
              <Button variant="secondary" size="md" onClick={() => lifecycle.mutate('stop')} disabled={lifecycle.isPending} title="Stop">
                <Square size={15} /> Stop
              </Button>
            </>
          )}
          {svc.status === 'stopped' && (
            <Button variant="secondary" size="md" onClick={() => lifecycle.mutate('start')} disabled={lifecycle.isPending}>
              <Play size={15} /> Start
            </Button>
          )}
          {svc.runtimeId && (
            <Button variant="ghost" size="md" onClick={() => setShowRuntimeLogs((v) => !v)}>
              <Terminal size={15} /> {showRuntimeLogs ? 'Hide logs' : 'Runtime logs'}
            </Button>
          )}
          {svc.runtimeId && (
            <Button variant="ghost" size="md" onClick={() => setShowExec((v) => !v)}>
              <Terminal size={15} /> {showExec ? 'Hide shell' : 'Exec'}
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={doExportService} title="Export service">
            <Download size={15} /> Export
          </Button>
        </div>
      </div>

      {showRuntimeLogs && (
        <Card className="mt-5">
          <CardBody>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Terminal size={15} className="text-slate-500" /> Runtime logs
              </div>
              <span className="text-xs text-slate-600">live · auto-refresh 3s</span>
            </div>
            <pre className="h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-300 ring-1 ring-inset ring-white/5">
              {runtimeLogs.data?.lines || 'No logs yet.'}
            </pre>
          </CardBody>
        </Card>
      )}

      {showExec && svc.runtimeId && (
        <div className="mt-5">
          <ContainerTerminal serviceId={id} onClose={() => setShowExec(false)} />
        </div>
      )}

      <Tabs
        className="mt-6"
        active={tab}
        onChange={(t) => setTab(t as TabId)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'settings', label: 'Settings' },
          { id: 'network', label: 'Network' },
          { id: 'config', label: 'Config' },
          { id: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-2">
            <MetricsCard serviceId={id} />
            <RuntimeInfoCard svc={svc} />
            <DeploymentsCard
              deploys={deploys.data ?? []}
              activeId={activeDeploy}
              onSelect={setActiveDeploy}
              onRollback={(depId) => {
                rollback.mutate(depId);
                setActiveDeploy(null);
              }}
              onCancel={(depId) => cancelDeploy.mutate(depId)}
              loading={deploys.isLoading}
            />
          </div>

          <Card className="lg:col-span-3">
            <CardBody className="flex h-full flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <span className="flex h-2 w-2 items-center justify-center">
                    <span className={cn('h-2 w-2 rounded-full', inFlight ? 'bg-amber-400' : 'bg-slate-600')} />
                  </span>
                  Live log {activeDeployRow ? `· #${activeDeployRow.id}` : ''}
                </div>
                {inFlight && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-300">
                    <Spinner className="h-3 w-3" /> building
                  </span>
                )}
              </div>
              <LogPanel serviceId={id} deploymentId={activeDeploy} />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'settings' && (
        <div className="mt-5 space-y-5">
          <SettingsCard serviceId={id} />
          <LimitsCard svc={svc} />
        </div>
      )}

      {tab === 'network' && (
        <div className="mt-5 max-w-3xl space-y-5">
          <DomainsCard serviceId={id} />
        </div>
      )}

      {tab === 'config' && (
        <div className="mt-5 grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <EnvCard serviceId={id} />
            <WebhooksCard serviceId={id} />
          </div>
          <div className="space-y-5">
            <AttachmentsCard serviceId={id} />
            <JobsCard serviceId={id} />
          </div>
        </div>
      )}

      {tab === 'activity' && <ActivityCard serviceId={id} name={svc.name} />}

      {/* Danger zone */}
      <DangerZone
        slug={svc.slug}
        name={svc.name}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onDelete={() => removeService.mutate()}
        deleting={removeService.isPending}
      />
    </div>
  );
}

// ── Metrics (CPU / memory sparklines) ─────────────────────────────────────
function MetricsCard({ serviceId }: { serviceId: number }) {
  const cpu = useQuery({
    queryKey: ['svc-metrics', serviceId, 'cpu'],
    queryFn: () => api.stats.metrics(serviceId, { kind: 'cpu', minutes: 60 }),
    refetchInterval: 15000,
  });
  const mem = useQuery({
    queryKey: ['svc-metrics', serviceId, 'memory'],
    queryFn: () => api.stats.metrics(serviceId, { kind: 'memory', minutes: 60 }),
    refetchInterval: 15000,
  });

  const latest = (series: typeof cpu.data) => series?.points.at(-1)?.value ?? null;

  return (
    <Card>
      <CardBody>
        <div className="mb-3 text-sm font-medium text-slate-300">Metrics · last 60 min</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1"><Cpu size={12} /> CPU</span>
              <span className="font-mono text-slate-300">{latest(cpu.data) != null ? `${latest(cpu.data)}%` : '—'}</span>
            </div>
            <Sparkline points={(cpu.data?.points ?? []).map((p) => p.value)} color="#818cf8" width={220} height={40} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1"><MemoryStick size={12} /> Memory</span>
              <span className="font-mono text-slate-300">{latest(mem.data) != null ? `${latest(mem.data)} MiB` : '—'}</span>
            </div>
            <Sparkline points={(mem.data?.points ?? []).map((p) => p.value)} color="#34d399" width={220} height={40} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Runtime metadata ───────────────────────────────────────────────────────
function RuntimeInfoCard({ svc }: { svc: import('@ninedeploy/sdk').Service }) {
  const rows: Array<[string, string]> = [
    ['Runtime', svc.runtimeId ?? 'not deployed'],
    ['Commit', svc.commitSha?.slice(0, 12) ?? '—'],
    ['Image', svc.image ?? '—'],
    ['Port', svc.port ? String(svc.port) : '—'],
    ['Health path', svc.healthPath || '/'],
    ['CPU shares', svc.cpuShares ? String(svc.cpuShares) : 'unlimited'],
    ['Memory limit', svc.memLimitMb ? `${svc.memLimitMb} MiB` : 'unlimited'],
    ['Volume', svc.volumeMount ?? '—'],
  ];

  return (
    <Card>
      <CardBody>
        <div className="mb-3 text-sm font-medium text-slate-300">Runtime</div>
        <dl className="space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 text-slate-500">{k}</dt>
              <dd className="truncate font-mono text-slate-300" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
        {svc.build && (
          <>
            <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Build</div>
            <dl className="space-y-1.5">
              {(
                [
                  ['Pack', svc.build.buildPack],
                  ['Base dir', svc.build.baseDir],
                  ['Install', svc.build.installCmd],
                  ['Build', svc.build.buildCmd],
                  ['Start', svc.build.startCmd],
                  ['Dockerfile', svc.build.dockerfilePath],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt className="shrink-0 text-slate-500">{k}</dt>
                  <dd className="truncate font-mono text-slate-300" title={v ?? undefined}>{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ── Settings (service fields + build config) ───────────────────────────────
function SettingsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const service = useQuery({ queryKey: ['service', serviceId], queryFn: () => api.services.get(serviceId) });
  const svc = service.data;

  const [form, setForm] = useState<{
    name: string; branch: string; repoUrl: string; image: string; port: string;
    healthPath: string; volumeMount: string;
    buildPack: string; baseDir: string; installCmd: string; buildCmd: string; startCmd: string; dockerfilePath: string;
  } | null>(null);
  useEffect(() => {
    if (!svc || form) return;
    setForm({
      name: svc.name,
      branch: svc.branch,
      repoUrl: svc.repoUrl ?? '',
      image: svc.image ?? '',
      port: svc.port ? String(svc.port) : '',
      healthPath: svc.healthPath ?? '',
      volumeMount: svc.volumeMount ?? '',
      buildPack: svc.build?.buildPack ?? 'auto',
      baseDir: svc.build?.baseDir ?? '/',
      installCmd: svc.build?.installCmd ?? '',
      buildCmd: svc.build?.buildCmd ?? '',
      startCmd: svc.build?.startCmd ?? '',
      dockerfilePath: svc.build?.dockerfilePath ?? '',
    });
  }, [svc, form]);

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      // Omit empty optional fields so a PATCH never clears values the form left blank.
      const orUndef = <T,>(v: T) => (v === '' ? undefined : v);
      return api.services.update(serviceId, {
        name: f.name,
        branch: f.branch,
        repoUrl: orUndef(f.repoUrl),
        image: orUndef(f.image),
        port: orUndef(f.port) ? Number(f.port) : undefined,
        healthPath: orUndef(f.healthPath),
        volumeMount: orUndef(f.volumeMount),
        build: {
          buildPack: f.buildPack as 'auto' | 'nixpacks' | 'dockerfile',
          baseDir: f.baseDir,
          installCmd: orUndef(f.installCmd),
          buildCmd: orUndef(f.buildCmd),
          startCmd: orUndef(f.startCmd),
          dockerfilePath: orUndef(f.dockerfilePath),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', serviceId] });
      qc.invalidateQueries({ queryKey: ['services'] });
      toast('Settings saved — redeploy to apply', 'success');
    },
    onError: () => toast('Could not save settings', 'error'),
  });

  if (!svc || !form) return <Card><CardBody><Skeleton className="h-40 w-full" /></CardBody></Card>;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Settings size={15} className="text-slate-500" /> Service settings
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Field label="Name"><Input value={form.name} onChange={set('name')} className="h-9" /></Field>
          <Field label="Branch"><Input value={form.branch} onChange={set('branch')} className="h-9" /></Field>
          <Field label="Repo URL"><Input value={form.repoUrl} onChange={set('repoUrl')} placeholder="https://github.com/…" className="h-9 font-mono text-xs" /></Field>
          <Field label="Image (image deploys)"><Input value={form.image} onChange={set('image')} placeholder="nginx:latest" className="h-9 font-mono text-xs" /></Field>
          <Field label="Port"><Input value={form.port} onChange={set('port')} inputMode="numeric" placeholder="3000" className="h-9 font-mono text-xs" /></Field>
          <Field label="Health path"><Input value={form.healthPath} onChange={set('healthPath')} placeholder="/" className="h-9 font-mono text-xs" /></Field>
          <Field label="Volume mount"><Input value={form.volumeMount} onChange={set('volumeMount')} placeholder="/app/data" className="h-9 font-mono text-xs" /></Field>

          <div className="col-span-full mt-2 border-t border-white/5 pt-4 text-xs font-medium uppercase tracking-wide text-slate-500">
            Build configuration
          </div>
          <Field label="Build pack">
            <Select value={form.buildPack} onChange={set('buildPack')} className="h-9">
              <option value="auto">auto</option>
              <option value="nixpacks">nixpacks</option>
              <option value="dockerfile">dockerfile</option>
            </Select>
          </Field>
          <Field label="Base directory"><Input value={form.baseDir} onChange={set('baseDir')} className="h-9 font-mono text-xs" /></Field>
          <Field label="Install command"><Input value={form.installCmd} onChange={set('installCmd')} placeholder="npm ci" className="h-9 font-mono text-xs" /></Field>
          <Field label="Build command"><Input value={form.buildCmd} onChange={set('buildCmd')} placeholder="npm run build" className="h-9 font-mono text-xs" /></Field>
          <Field label="Start command"><Input value={form.startCmd} onChange={set('startCmd')} placeholder="npm start" className="h-9 font-mono text-xs" /></Field>
          <Field label="Dockerfile path"><Input value={form.dockerfilePath} onChange={set('dockerfilePath')} placeholder="./Dockerfile" className="h-9 font-mono text-xs" /></Field>

          <div className="col-span-full">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
            <span className="ml-3 text-xs text-slate-500">Build + runtime changes apply on the next deploy.</span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ── Resource limits ────────────────────────────────────────────────────────
function LimitsCard({ svc }: { svc: import('@ninedeploy/sdk').Service }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Initialized once from the service row — later refetches never fight user edits.
  const [cpu, setCpu] = useState(String(svc.cpuShares || ''));
  const [mem, setMem] = useState(String(svc.memLimitMb || ''));

  const save = useMutation({
    mutationFn: () =>
      api.limits.setService(svc.id, {
        cpuShares: Number(cpu) || 0,
        memLimitMb: Number(mem) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', svc.id] });
      toast('Limits saved — applied on next deploy', 'success');
    },
    onError: () => toast('Could not save limits', 'error'),
  });

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Cpu size={15} className="text-slate-500" /> Resource limits
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-wrap items-end gap-4"
        >
          <Field label="CPU shares (0 = unlimited)">
            <Input value={cpu} onChange={(e) => setCpu(e.target.value)} inputMode="numeric" className="h-9 w-44 font-mono text-xs" />
          </Field>
          <Field label="Memory limit MiB (0 = unlimited)">
            <Input value={mem} onChange={(e) => setMem(e.target.value)} inputMode="numeric" className="h-9 w-44 font-mono text-xs" />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save limits'}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          CPU shares map to Docker's <code className="font-mono">--cpu-shares</code> (max 262144); memory to <code className="font-mono">--memory</code>. Applied on the next deploy.
        </p>
      </CardBody>
    </Card>
  );
}

// ── Domains ───────────────────────────────────────────────────────────────
function DomainsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [hostname, setHostname] = useState('');

  const domains = useQuery({ queryKey: ['domains', serviceId], queryFn: () => api.domains.list(serviceId) });
  const add = useMutation({
    mutationFn: () => api.domains.create(serviceId, { hostname }),
    onSuccess: () => {
      setHostname('');
      qc.invalidateQueries({ queryKey: ['domains', serviceId] });
    },
    onError: () => toast('Could not add the domain', 'error'),
  });
  const remove = useMutation({
    mutationFn: (domainId: number) => api.domains.remove(serviceId, domainId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
    onError: () => toast('Could not remove the domain', 'error'),
  });
  const toggleSsl = useMutation({
    mutationFn: (d: { id: number; ssl: boolean }) => api.domains.setSsl(d.id, !d.ssl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
    onError: () => toast('Could not toggle SSL', 'error'),
  });
  const toggleWww = useMutation({
    mutationFn: (d: { id: number; redirectWww: boolean }) =>
      api.domains.update(serviceId, d.id, { redirectWww: !d.redirectWww }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
    onError: () => toast('Could not toggle the www redirect', 'error'),
  });

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Globe size={15} className="text-slate-500" /> Domains
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (hostname.trim()) add.mutate();
          }}
          className="flex gap-2"
        >
          <Input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="app.example.com"
            className="h-9"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!hostname.trim() || add.isPending}>
            <Plus size={14} /> Add
          </Button>
        </form>

        <div className="mt-3 space-y-1.5">
          {domains.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !domains.data || domains.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No domains attached.</p>
          ) : (
            domains.data.map((d) => (
              <div
                key={d.id}
                className="group flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    href={`${d.ssl ? 'https' : 'http'}://${d.hostname}${d.path}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 truncate font-mono text-xs text-slate-300 hover:text-indigo-300"
                  >
                    {d.hostname}
                    {d.path !== '/' && <span className="text-slate-500">{d.path}</span>}
                    <ExternalLink size={11} className="shrink-0 opacity-0 transition group-hover:opacity-100" />
                  </a>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleSsl.mutate({ id: d.id, ssl: d.ssl })}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition',
                      d.ssl
                        ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20 hover:bg-emerald-500/25'
                        : 'bg-slate-500/15 text-slate-400 ring-slate-500/20 hover:bg-slate-500/25',
                    )}
                    title={d.ssl ? 'HTTPS on — click to disable' : 'HTTPS off — click to issue a certificate'}
                  >
                    {d.ssl ? 'HTTPS' : 'HTTP'}
                  </button>
                  <button
                    onClick={() => toggleWww.mutate({ id: d.id, redirectWww: d.redirectWww })}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition',
                      d.redirectWww
                        ? 'bg-sky-500/15 text-sky-300 ring-sky-500/20 hover:bg-sky-500/25'
                        : 'bg-slate-500/15 text-slate-400 ring-slate-500/20 hover:bg-slate-500/25',
                    )}
                    title={d.redirectWww ? 'www→apex redirect on — click to disable' : 'Redirect www. to the apex host — click to enable'}
                  >
                    www
                  </button>
                  <button
                    onClick={() => remove.mutate(d.id)}
                    className="text-slate-600 transition hover:text-rose-400"
                    title="Remove domain"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Webhooks ──────────────────────────────────────────────────────────────
function WebhooksCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null);
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null);
  const [watchPaths, setWatchPaths] = useState('');

  const hooks = useQuery({ queryKey: ['webhooks', serviceId], queryFn: () => api.webhooks.list(serviceId) });
  const create = useMutation({
    mutationFn: () => api.webhooks.create(serviceId, watchPaths.trim() ? { watchPaths: watchPaths.trim() } : undefined),
    onSuccess: (w) => {
      setRevealed({ url: w.url, secret: w.secret });
      setWatchPaths('');
      qc.invalidateQueries({ queryKey: ['webhooks', serviceId] });
    },
    onError: () => toast('Could not create the webhook', 'error'),
  });
  const remove = useMutation({
    mutationFn: (hookId: number) => api.webhooks.remove(serviceId, hookId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', serviceId] }),
    onError: () => toast('Could not remove the webhook', 'error'),
  });

  const copy = async (which: 'url' | 'secret', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <Webhook size={15} className="text-slate-500" /> Auto-deploy
          </div>
          <Button size="sm" variant="secondary" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus size={14} /> New
          </Button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="mb-3"
        >
          <Input
            value={watchPaths}
            onChange={(e) => setWatchPaths(e.target.value)}
            placeholder="Watch paths (optional) — e.g. services/api/**, packages/**"
            className="h-8 font-mono text-[11px]"
          />
          <p className="mt-1 text-[10px] text-slate-600">
            Comma or newline separated globs. Only pushes touching these paths deploy (monorepo-friendly). Leave empty to deploy on every push.
          </p>
        </form>

        {revealed && (
          <div className="mb-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
            <p className="text-xs font-medium text-amber-200">
              Copy these now — the secret is shown only once.
            </p>
            <SecretRow
              label="Payload URL"
              value={revealed.url}
              copied={copied === 'url'}
              onCopy={() => copy('url', revealed.url)}
            />
            <SecretRow
              label="Secret"
              value={revealed.secret}
              copied={copied === 'secret'}
              onCopy={() => copy('secret', revealed.secret)}
            />
            <button
              onClick={() => setRevealed(null)}
              className="text-xs text-amber-200/70 underline-offset-2 hover:underline"
            >
              I&apos;ve saved it
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          {hooks.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !hooks.data || hooks.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No webhooks. Create one and add it to GitHub/GitLab.</p>
          ) : (
            hooks.data.map((w) => (
              <div
                key={w.id}
                className="group flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                    <GitBranch size={11} /> {w.branch}
                    {w.watchPaths && (
                      <span className="truncate rounded bg-indigo-500/10 px-1.5 text-[10px] text-indigo-300" title={w.watchPaths}>
                        watch: {w.watchPaths.split(/[\n,]/).filter(Boolean).length} path(s)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => copy('url', w.url)}
                    className="mt-0.5 flex items-center gap-1 truncate font-mono text-[11px] text-slate-300 hover:text-indigo-300"
                    title={w.url}
                  >
                    <span className="truncate">{w.url}</span>
                    <Copy size={10} className="shrink-0 opacity-0 group-hover:opacity-100" />
                  </button>
                </div>
                <button
                  onClick={() => remove.mutate(w.id)}
                  className="text-slate-600 transition hover:text-rose-400"
                  title="Remove webhook"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function SecretRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-amber-200/60">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-amber-100">
          {value}
        </code>
        <button onClick={onCopy} className="shrink-0 text-amber-200/80 hover:text-amber-100">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

// ── Deployments ───────────────────────────────────────────────────────────
function DeploymentsCard({
  deploys,
  activeId,
  onSelect,
  onRollback,
  onCancel,
  loading,
}: {
  deploys: import('@ninedeploy/sdk').Deployment[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onRollback?: (deploymentId: number) => void;
  onCancel?: (deploymentId: number) => void;
  loading: boolean;
}) {
  return (
    <Card>
      <CardBody>
        <div className="mb-3 text-sm font-medium text-slate-300">Deployments</div>
        {loading ? (
          <Skeleton className="h-8 w-full" />
        ) : deploys.length === 0 ? (
          <p className="py-2 text-xs text-slate-600">No deployments yet.</p>
        ) : (
          <ul className="space-y-1">
            {deploys.map((d, i) => {
              const duration =
                d.startedAt && d.finishedAt
                  ? Math.max(1, Math.round((new Date(d.finishedAt).getTime() - new Date(d.startedAt).getTime()) / 1000))
                  : null;
              return (
                <li key={d.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => onSelect(d.id)}
                    className={cn(
                      'flex flex-1 items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition',
                      d.id === activeId ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">#{d.id}</span>
                        <span className="font-mono text-xs text-slate-300">{d.commitSha?.slice(0, 7) ?? '—'}</span>
                        <StatusBadge status={d.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {d.message ? d.message : <span className="italic">no commit message</span>}
                        {' · '}
                        {d.trigger}
                        {d.author ? ` · ${d.author}` : ''}
                        {duration != null ? ` · ${duration}s` : ''}
                      </span>
                    </span>
                  </button>
                  {onCancel && IN_FLIGHT.includes(d.status) && (
                    <button
                      onClick={() => onCancel(d.id)}
                      className="shrink-0 rounded p-1.5 text-slate-500 opacity-0 transition hover:bg-white/5 hover:text-amber-300 group-hover:opacity-100"
                      title={`Cancel deployment #${d.id}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                  {onRollback && i > 0 && !IN_FLIGHT.includes(d.status) && d.status !== 'failed' && d.status !== 'cancelled' && (
                    <button
                      onClick={() => onRollback(d.id)}
                      className="shrink-0 rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-white/5 hover:text-indigo-300 group-hover:opacity-100"
                      title={`Rollback to #${d.id}`}
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ── Activity (audit trail filtered to this service) ───────────────────────
type ActivityRow = { id: number; userId: number; action: string; entity: string; ts: string };

function ActivityCard({ serviceId, name }: { serviceId: number; name: string }) {
  const { toast } = useToast();
  const activity = useQuery({
    queryKey: ['activity', serviceId],
    queryFn: async () => (await api.activity.list()) as ActivityRow[],
    refetchInterval: 10000,
  });
  const rows = useMemo(
    () => (activity.data ?? []).filter((r) => r.entity === name),
    [activity.data, name],
  );

  const exportBundle = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.services.exportUrl(serviceId), { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast('Service exported', 'success'),
    onError: () => toast('Export failed', 'error'),
  });

  return (
    <Card className="mt-5">
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <Activity size={15} className="text-slate-500" /> Activity
          </div>
          <Button size="sm" variant="ghost" onClick={() => exportBundle.mutate()} disabled={exportBundle.isPending}>
            <Download size={13} /> Export bundle
          </Button>
        </div>
        {activity.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-2 text-xs text-slate-600">No recorded activity for this service yet.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-xs ring-1 ring-inset ring-white/5"
              >
                <span className="font-mono text-slate-300">{r.action}</span>
                <span className="text-slate-500">{new Date(r.ts).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-slate-600">Auto-refreshes every 10s · audit log retained 90 days.</p>
      </CardBody>
    </Card>
  );
}

// ── Scheduled jobs (cron) ─────────────────────────────────────────────────
function JobsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const [kind, setKind] = useState<'deploy' | 'exec'>('deploy');
  const [command, setCommand] = useState('');

  const jobs = useQuery({ queryKey: ['jobs', serviceId], queryFn: () => api.jobs.list(serviceId) });
  const create = useMutation({
    mutationFn: () => api.jobs.create(serviceId, { name, cron, kind, command: kind === 'exec' ? command : undefined }),
    onSuccess: () => {
      setName('');
      setCron('');
      setCommand('');
      qc.invalidateQueries({ queryKey: ['jobs', serviceId] });
      toast('Job created — active within 5 minutes', 'success');
    },
    onError: () => toast('Could not create the job', 'error'),
  });
  const remove = useMutation({
    mutationFn: (jobId: number) => api.jobs.remove(serviceId, jobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs', serviceId] }),
  });
  const runNow = useMutation({
    mutationFn: (jobId: number) => api.jobs.run(serviceId, jobId),
    onSuccess: () => toast('Job executed', 'success'),
    onError: () => toast('Job run failed', 'error'),
  });
  const toggle = useMutation({
    mutationFn: (j: { id: number; enabled: boolean }) => api.jobs.update(serviceId, j.id, { enabled: !j.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs', serviceId] }),
  });

  const canCreate = name.trim() && cron.trim() && (kind === 'deploy' || command.trim());

  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Clock size={15} className="text-slate-500" /> Scheduled jobs
        </div>
        <p className="mb-3 text-xs text-slate-500">Cron-scheduled redeploys or container commands (5-field expressions, server timezone).</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) create.mutate();
          }}
          className="space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="nightly-rebuild" className="h-8 text-xs" />
            <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 3 * * *" className="h-8 font-mono text-xs" />
          </div>
          <div className="flex gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'deploy' | 'exec')}
              className="h-8 flex-1 rounded-lg bg-black/30 px-2 text-xs text-slate-100 ring-1 ring-inset ring-white/10"
            >
              <option value="deploy">Redeploy the service</option>
              <option value="exec">Run a command in the container</option>
            </select>
            {kind === 'exec' && (
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="pg_dump … / npm run cache:clean" className="h-8 flex-1 font-mono text-xs" />
            )}
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={!canCreate || create.isPending}>
            <Plus size={13} /> Add job
          </Button>
        </form>

        <div className="mt-3 space-y-1.5">
          {jobs.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !jobs.data || jobs.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No scheduled jobs.</p>
          ) : (
            jobs.data.map((j) => (
              <div key={j.id} className="group flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-slate-200">{j.name}</span>
                    <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">{j.cron}</code>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{j.kind}</span>
                  </div>
                  {j.kind === 'exec' && j.command && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={j.command}>{j.command}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggle.mutate({ id: j.id, enabled: j.enabled })}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition',
                      j.enabled ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20' : 'bg-slate-500/15 text-slate-400 ring-slate-500/20',
                    )}
                  >
                    {j.enabled ? 'on' : 'off'}
                  </button>
                  <button onClick={() => runNow.mutate(j.id)} className="text-[11px] text-slate-500 hover:text-indigo-300" title="Run now">
                    run
                  </button>
                  <button onClick={() => remove.mutate(j.id)} className="text-slate-600 transition hover:text-rose-400" title="Delete job">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Danger zone (with the service's data volume surfaced) ──────────────────
function DangerZone({
  slug,
  name,
  confirmDelete,
  setConfirmDelete,
  onDelete,
  deleting,
}: {
  slug: string;
  name: string;
  confirmDelete: string;
  setConfirmDelete: (v: string) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const volumeName = `nd-svc-${slug}-data`;
  const volumes = useQuery({
    queryKey: ['volumes'],
    queryFn: () => api.volumes.list(),
    select: (list) => list.find((v) => v.name === volumeName) ?? null,
  });
  const dataVolume = volumes.data;

  return (
    <Card className="mt-6 border-rose-500/20">
      <CardBody>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-rose-300">
          <Trash2 size={14} /> Danger zone
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Deleting removes the container, domains, webhooks, env vars and deployment history.
          The data volume is retained (delete it separately under Volumes if you want it gone).
        </p>
        {dataVolume && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <HardDrive size={12} className="text-slate-500" />
            Data volume <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">{volumeName}</code>
            exists ({formatBytes(dataVolume.sizeBytes)}){dataVolume.inUse ? ' · in use' : ''} and will be kept.
          </p>
        )}
        <div className="mt-3 flex max-w-md items-center gap-2">
          <Input
            value={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.value)}
            placeholder={`Type "${name}" to confirm`}
            className="h-8 text-xs"
            aria-label="Confirm service name"
          />
          <Button variant="danger" size="sm" className="h-8" disabled={confirmDelete !== name || deleting} onClick={onDelete}>
            {deleting ? 'Deleting…' : 'Delete service'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function formatBytes(n: number): string {
  if (n <= 0) return 'empty';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}

// ── Log panel (terminal) ──────────────────────────────────────────────────
function LogPanel({ serviceId, deploymentId }: { serviceId: number; deploymentId: number | null }) {
  const { lines, open } = useDeployLogs(serviceId, deploymentId);
  const ref = useRef<HTMLPreElement>(null);
  useAutoScroll(ref, lines);
  const empty = useMemo(() => deploymentId == null, [deploymentId]);

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 py-16 text-center text-sm text-slate-600">
        Trigger a deploy to see live logs.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a10]">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-2 font-mono text-[11px] text-slate-500">deploy #{deploymentId}</span>
      </div>
      <pre ref={ref} className="h-[22rem] overflow-auto p-3 font-mono text-xs leading-relaxed text-slate-300">
        {lines || (open ? '' : 'Connecting…')}
      </pre>
    </div>
  );
}

function useAutoScroll(ref: RefObject<HTMLPreElement | null>, content: string): void {
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, ref]);
}
