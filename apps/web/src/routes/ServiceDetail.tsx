import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, ExternalLink, GitBranch, Globe, Play, Plus, Rocket, RotateCcw, Square, Terminal, Trash2, Webhook } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api, getToken } from '../lib/api.js';
import { useDeployLogs } from '../lib/useDeployLogs.js';
import { AttachmentsCard } from '../components/AttachmentsCard.js';
import { ContainerTerminal } from '../components/ContainerTerminal.js';
import { EnvCard } from '../components/EnvCard.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, CardBody, Input, Skeleton, Spinner, StatusBadge, cn } from '../components/ui.js';

const IN_FLIGHT = ['queued', 'building', 'deploying'];

export function ServiceDetail() {
  const params = useParams();
  const id = Number(params['id']);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeDeploy, setActiveDeploy] = useState<number | null>(null);

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
  });

  const [showRuntimeLogs, setShowRuntimeLogs] = useState(false);
  const [showExec, setShowExec] = useState(false);

  const doExportService = async () => {
    try {
      toast('Exporting service…', 'info');
      const res = await fetch(`/v1/services/${id}/export`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
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
            <span className="truncate">{svc.repoUrl}</span>
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

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-2">
          <DomainsCard serviceId={id} />
          <AttachmentsCard serviceId={id} />
          <EnvCard serviceId={id} />
          <WebhooksCard serviceId={id} />
          <DeploymentsCard
            deploys={deploys.data ?? []}
            activeId={activeDeploy}
            onSelect={setActiveDeploy}
            onRollback={(depId) => {
              rollback.mutate(depId);
              setActiveDeploy(null);
            }}
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
    </div>
  );
}

// ── Domains ───────────────────────────────────────────────────────────────
function DomainsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const [hostname, setHostname] = useState('');

  const domains = useQuery({ queryKey: ['domains', serviceId], queryFn: () => api.domains.list(serviceId) });
  const add = useMutation({
    mutationFn: () => api.domains.create(serviceId, { hostname }),
    onSuccess: () => {
      setHostname('');
      qc.invalidateQueries({ queryKey: ['domains', serviceId] });
    },
  });
  const remove = useMutation({
    mutationFn: (domainId: number) => api.domains.remove(serviceId, domainId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
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
                    href={`http://${d.hostname}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 truncate font-mono text-xs text-slate-300 hover:text-indigo-300"
                  >
                    {d.hostname}
                    <ExternalLink size={11} className="shrink-0 opacity-0 transition group-hover:opacity-100" />
                  </a>
                </div>
                <button
                  onClick={() => remove.mutate(d.id)}
                  className="text-slate-600 transition hover:text-rose-400"
                  title="Remove domain"
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

// ── Webhooks ──────────────────────────────────────────────────────────────
function WebhooksCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null);
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null);

  const hooks = useQuery({ queryKey: ['webhooks', serviceId], queryFn: () => api.webhooks.list(serviceId) });
  const create = useMutation({
    mutationFn: () => api.webhooks.create(serviceId),
    onSuccess: (w) => {
      setRevealed({ url: w.url, secret: w.secret });
      qc.invalidateQueries({ queryKey: ['webhooks', serviceId] });
    },
  });
  const remove = useMutation({
    mutationFn: (hookId: number) => api.webhooks.remove(serviceId, hookId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', serviceId] }),
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
  loading,
}: {
  deploys: import('@ninedeploy/sdk').Deployment[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onRollback?: (deploymentId: number) => void;
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
            {deploys.map((d, i) => (
              <li key={d.id} className="group flex items-center gap-1">
                <button
                  onClick={() => onSelect(d.id)}
                  className={cn(
                    'flex flex-1 items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition',
                    d.id === activeId ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">#{d.id}</span>
                    <span className="font-mono text-xs text-slate-300">{d.commitSha?.slice(0, 7) ?? '—'}</span>
                  </span>
                  <StatusBadge status={d.status} />
                </button>
                {onRollback && i > 0 && d.status === 'running' && (
                  <button
                    onClick={() => onRollback(d.id)}
                    className="shrink-0 rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-white/5 hover:text-indigo-300 group-hover:opacity-100"
                    title={`Rollback to #${d.id}`}
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
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
