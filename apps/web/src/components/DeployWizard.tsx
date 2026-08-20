import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus, Rocket, Sparkles, Terminal, X, Zap } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Template } from '@ninedeploy/sdk';
import { api } from '../lib/api.js';
import { toInt } from '../lib/format.js';
import { useProjectScope } from '../lib/projects.js';
import { useExperienceMode } from '../lib/mode.js';
import { useToast } from './Toast.js';
import { Button, Input, Select, cn } from './ui.js';

const STEPS = ['Source', 'Runtime', 'Environment', 'Resources', 'Review'];

interface EnvRow { key: string; value: string; secret: boolean }

export function DeployWizard({ template, onClose }: { template?: Template; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdvanced } = useExperienceMode();
  const { selectedId: projectId } = useProjectScope();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.sources.list() });
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api.servers.list() });

  const [step, setStep] = useState(0);
  const [name, setName] = useState(template?.name ?? '');
  const [serverId, setServerId] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Modal hygiene: focus the first field on open so keyboard/screen-reader
  // users land IN the dialog (not the page behind it), close on Escape, and
  // lock background scrolling while the wizard is up.
  const busyRef = useRef(false);
  useEffect(() => {
    nameInputRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const [type, setType] = useState<'docker' | 'pm2' | 'compose'>('docker');
  const [mode, setMode] = useState<'repo' | 'image'>(template ? 'image' : 'repo');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [sourceId, setSourceId] = useState('');
  const remoteRepos = useQuery({
    queryKey: ['source-repos', sourceId],
    queryFn: () => api.sources.repos(Number(sourceId)),
    enabled: Boolean(sourceId && Number(sourceId) > 0),
  });
  const remoteBranches = useQuery({
    queryKey: ['source-branches', sourceId, repoUrl],
    queryFn: () => api.sources.branches(Number(sourceId), repoUrl),
    enabled: Boolean(sourceId && Number(sourceId) > 0 && repoUrl),
  });
  const [image, setImage] = useState(template?.image ?? '');
  // Source/buildpack apps conventionally listen on $PORT. A visible default
  // prevents a successful first deploy from ending up with no Traefik target;
  // image/template deploys retain their registry-declared port.
  const [port, setPort] = useState(template ? String(template.port) : '3000');
  const [publishedPort, setPublishedPort] = useState('');
  const [volumeMount, setVolumeMount] = useState(template?.volumeMount ?? '');
  const [healthPath, setHealthPath] = useState('/');
  const [cpuShares, setCpuShares] = useState('');
  const [memLimitMb, setMemLimitMb] = useState('');
  // Empty registry-secret rows are omitted from the request. The canonical
  // server route generates them on first install and preserves them on retry;
  // typing an explicit value here intentionally overrides the stored secret.
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    (template?.env ?? []).map((e) => ({ key: e.key, value: e.secret ? '' : e.value, secret: e.secret ?? false })),
  );
  // Database-backed templates are provisioned atomically by the server route.
  const dbEngine = template?.dbEngine ?? null;
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);

  const deploy = useMutation({
    onMutate: () => {
      // While the deploy mutation is in flight (service+env+db+trigger),
      // closing the dialog must not run: the flow would keep going against
      // an unmounted wizard and the final navigate would fire anyway.
      busyRef.current = true;
      setProvisionStatus(template
        ? `Server is reconciling service → environment${dbEngine ? ` → ${dbEngine} database → attachment` : ''} → deployment queue…`
        : 'Creating service and queueing deployment…');
    },
    onSettled: () => {
      busyRef.current = false;
    },
    mutationFn: async () => {
      if (template) {
        const result = await api.templates.deploy(template.id, {
          name,
          projectId: projectId ?? undefined,
          serverId: serverId ? toInt(serverId) : undefined,
          publishedPort: toInt(publishedPort),
          healthPath: healthPath || undefined,
          cpuShares: toInt(cpuShares),
          memLimitMb: toInt(memLimitMb),
          env: envRows
            .filter((entry) => entry.key.trim())
            .filter((entry) => !(entry.secret && entry.value === '' && template.env?.some((preset) => preset.key === entry.key && preset.secret)))
            .map((entry) => ({ key: entry.key.trim(), value: entry.value, isSecret: entry.secret })),
          reuseExisting: true,
        });
        return { serviceId: result.serviceId, deploymentId: result.deploymentId, canonical: true };
      }
      const svc = await api.services.create({
        name,
        type,
        projectId: projectId ?? undefined,
        ...(serverId ? { serverId: toInt(serverId) } : {}),
        repoUrl: mode === 'repo' ? repoUrl : undefined,
        image: mode === 'image' ? image : undefined,
        branch,
        sourceId: toInt(sourceId),
        port: toInt(port),
        publishedPort: toInt(publishedPort),
        volumeMount: volumeMount || undefined,
        healthPath: healthPath || undefined,
        cpuShares: toInt(cpuShares),
        memLimitMb: toInt(memLimitMb),
      });
      for (const e of envRows) {
        if (e.key.trim()) {
          await api.env.create(svc.id, {
            key: e.key,
            value: e.value,
            isSecret: e.secret,
          });
        }
      }
      const deployment = await api.deploys.trigger(svc.id);
      return { serviceId: svc.id, deploymentId: deployment.deploymentId, canonical: false };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['databases'] });
      toast(result.canonical ? 'Dependencies are ready — application deploy queued' : 'Deploy started — building…', 'info');
      navigate(`/services/${result.serviceId}?tab=deploys`);
      onClose();
    },
    onError: (err) => {
      setProvisionStatus('Provisioning failed — nothing was queued before its required dependencies were ready.');
      toast(err instanceof Error ? err.message : 'Deploy failed', 'error');
    },
  });

  const canNext =
    step === 0
      ? !!name.trim() && (mode === 'image' ? !!image.trim() : !!repoUrl.trim())
      : true;

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) next();
    else deploy.mutate();
  };

  const setEnv = (i: number, patch: Partial<EnvRow>) => setEnvRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const wizardContent = (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => !busyRef.current && onClose()}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={template ? `Deploy ${template.name}` : 'New service'}
        className="nd-fade relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl z-10"
      >
        {/* Header + stepper */}
        <div className="border-b border-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
              <Rocket size={18} className="text-indigo-400" />
              <span>{template ? `Deploy ${template.name}` : 'New service'}</span>
              <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border inline-flex items-center gap-1', isAdvanced ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300')}>
                {isAdvanced ? <><Terminal size={10} /> DevOps Pro</> : <><Sparkles size={10} /> Quick Mode</>}
              </span>
            </h2>
            <button type="button" onClick={() => !busyRef.current && onClose()} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-200 transition"><X size={16} /></button>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition', i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-indigo-500 text-white' : 'bg-white/10 text-slate-500')}>
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                <span className={cn('truncate text-[11px]', i === step ? 'text-slate-200' : 'text-slate-500')}>{label}</span>
                {i < STEPS.length - 1 && <div className="h-px flex-1 bg-white/10" />}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex-1 overflow-auto p-5">
          {deploy.isPending && template && (
            <div role="status" className="mb-4 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.08] p-3.5">
              <div className="mb-2 text-xs font-semibold text-indigo-200">Server provisioning pipeline</div>
              <div className="grid gap-1.5 text-[11px] text-slate-300">
                <span>1. Reconcile service configuration and persistent storage</span>
                <span>2. Reconcile environment variables and preserve existing secrets</span>
                {dbEngine && <span>3. Start and verify the required {dbEngine} database, then attach it</span>}
                <span>{dbEngine ? '4' : '3'}. Queue the application deployment only after dependencies are ready</span>
              </div>
            </div>
          )}
          {template && !template.runtimeVerified && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-200">
              Community template — registry-valid but not yet runtime-certified. Confirm its port, environment and storage settings before deployment.
            </div>
          )}
          {/* Step 1: Source */}
          {step === 0 && (
            <div className="space-y-4">
              <L label="Name"><Input ref={nameInputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" /></L>
              <div className="grid grid-cols-2 gap-3">
                <L label="Type">
                  <Select value={type} disabled={!!template} onChange={(e) => setType(e.target.value as 'docker' | 'pm2' | 'compose')}>
                    <option value="docker">Docker / Nixpacks</option>
                    <option value="compose">Compose</option>
                    <option value="pm2">PM2</option>
                  </Select>
                </L>
                <L label="Source type">
                  <div className="flex h-10 items-center gap-1 rounded-lg bg-black/30 p-1 ring-1 ring-inset ring-white/10">
                    {(['repo', 'image'] as const).map((m) => (
                      <button key={m} type="button" disabled={!!template} onClick={() => setMode(m)} className={cn('flex-1 rounded-md py-1 text-xs font-medium transition disabled:opacity-50', mode === m ? 'bg-indigo-500 text-white' : 'text-slate-400')}>{m === 'repo' ? 'Git repo' : 'Image'}</button>
                    ))}
                  </div>
                </L>
              </div>
              {mode === 'repo' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <L label="Source (Git Credential)">
                      <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                        <option value="">Public / none</option>
                        {sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
                      </Select>
                    </L>
                    {remoteRepos.data && remoteRepos.data.length > 0 ? (
                      <L label="Select Repository">
                        <Select
                          value={repoUrl}
                          onChange={(e) => {
                            const found = remoteRepos.data?.find((r) => r.url === e.target.value);
                            setRepoUrl(e.target.value);
                            if (found) {
                              if (!name) setName(found.name);
                              setBranch(found.defaultBranch || 'main');
                            }
                          }}
                        >
                          <option value="">Choose a repo ({remoteRepos.data.length})…</option>
                          {remoteRepos.data.map((r) => (
                            <option key={r.url} value={r.url}>
                              {r.fullName} {r.isPrivate ? '🔒' : '🌐'}
                            </option>
                          ))}
                        </Select>
                      </L>
                    ) : (
                      <L label="Repository Branch">
                        {remoteBranches.data && remoteBranches.data.length > 0 ? (
                          <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                            {remoteBranches.data.map((b) => (
                              <option key={b} value={b}>{b}</option>
                            ))}
                          </Select>
                        ) : (
                          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
                        )}
                      </L>
                    )}
                  </div>

                  <L label="Repository URL">
                    <Input
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/you/repo"
                      className="font-mono text-xs"
                    />
                  </L>

                  {remoteRepos.data && remoteRepos.data.length > 0 && (
                    <L label="Branch">
                      {remoteBranches.data && remoteBranches.data.length > 0 ? (
                        <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                          {remoteBranches.data.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </Select>
                      ) : (
                        <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
                      )}
                    </L>
                  )}
                </>
              ) : (
                <L label={template ? 'Registry-managed image' : 'Image'}><Input value={image} disabled={!!template} onChange={(e) => setImage(e.target.value)} placeholder="n8nio/n8n" className="font-mono text-xs" /></L>
              )}

              {!isAdvanced && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Zap size={14} className="text-emerald-400" />
                      Simple 1-Click Ready
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Standard web server ports and healthchecks are automatically configured.
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canNext || deploy.isPending}
                    onClick={() => deploy.mutate()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    {deploy.isPending ? 'Deploying…' : 'Quick Deploy'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Runtime (Ports & Volumes) */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <L label={template ? 'Registry-managed container port' : 'Container Port'}><Input value={port} disabled={!!template} onChange={(e) => setPort(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="3000" className="font-mono text-xs" /></L>
                <L label="Public Host Port (optional)"><Input value={publishedPort} onChange={(e) => setPublishedPort(e.target.value)} placeholder="e.g. 8080" className="font-mono text-xs" /></L>
              </div>
              <L label={template ? 'Registry-managed volume mount' : 'Persistent Volume Mount'}><Input value={volumeMount} disabled={!!template} onChange={(e) => setVolumeMount(e.target.value)} placeholder="/app/data" className="font-mono text-xs" /></L>
              <L label="Healthcheck Path"><Input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/" className="font-mono text-xs" /></L>

              {servers.data && servers.data.length > 0 && (
                <L label="Target Server Node (Cluster Deployment)">
                  <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
                    <option value="">Local Server (Primary / Master Node)</option>
                    {servers.data
                      .filter((s) => s.status !== 'pending')
                      .map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          🖥️ {s.name} ({s.host}:{s.port}) · {s.status}
                        </option>
                      ))}
                  </Select>
                </L>
              )}
            </div>
          )}

          {/* Step 3: Environment Variables */}
          {step === 2 && (
            <div className="space-y-3">
              {template?.requires && (
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-300">
                  {template.requires}
                </div>
              )}
              {dbEngine && (
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-indigo-300">Required managed {dbEngine} database</div>
                      <div className="text-[11px] text-slate-400">The server creates, waits for and attaches a dedicated database before the application is queued.</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-300 ring-1 ring-inset ring-emerald-500/20">Required</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Environment variables</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEnvRows((r) => [...r, { key: '', value: '', secret: false }])} className="h-7 text-xs">
                  <Plus size={13} /> Add variable
                </Button>
              </div>
              {envRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">
                  No environment variables.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {envRows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={r.key}
                        onChange={(e) => setEnv(i, { key: e.target.value })}
                        placeholder="KEY"
                        className="font-mono text-xs flex-1"
                      />
                      <Input
                        value={r.value}
                        type={r.secret ? 'password' : 'text'}
                        onChange={(e) => setEnv(i, { value: e.target.value })}
                        placeholder="value"
                        className="font-mono text-xs flex-1"
                      />
                      <button
                        type="button"
                        title="Toggle secret"
                        onClick={() => setEnv(i, { secret: !r.secret })}
                        className={cn('rounded p-1.5 text-xs transition', r.secret ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-slate-300')}
                      >
                        🔒
                      </button>
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => setEnvRows((rows) => rows.filter((_, idx) => idx !== i))}
                        className="rounded p-1.5 text-slate-500 hover:text-rose-400 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Resource Limits */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <L label="CPU shares (0 = unlimited)"><Input value={cpuShares} onChange={(e) => setCpuShares(e.target.value)} placeholder="512" className="font-mono text-xs" /></L>
                <L label="Memory limit MB (0 = unlimited)"><Input value={memLimitMb} onChange={(e) => setMemLimitMb(e.target.value)} placeholder="256" className="font-mono text-xs" /></L>
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {step === 4 && (
            <div className="space-y-2 text-sm">
              <Row label="Name" value={name} />
              <Row label="Type" value={type} />
              <Row label={mode === 'repo' ? 'Repository' : 'Image'} value={mode === 'repo' ? repoUrl : image} />
              {port && <Row label="Port" value={`:${port}`} />}
              {publishedPort && <Row label="Host Port" value={`:${publishedPort}`} />}
              {volumeMount && <Row label="Volume" value={volumeMount} />}
              <Row label="Env vars" value={String(envRows.filter((e) => e.key.trim()).length)} />
              <Row label="Limits" value={cpuShares || memLimitMb ? `${cpuShares || '—'} shares · ${memLimitMb || '—'} MB` : 'none'} />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 p-4 bg-slate-950/50">
          <Button type="button" variant="ghost" size="sm" onClick={back} className={cn(step === 0 && 'invisible')}><ArrowLeft size={14} /> Back</Button>
          <div className="flex items-center gap-3">
            {provisionStatus && <span className={cn('max-w-xs text-right text-xs', deploy.isError ? 'text-rose-300' : 'text-emerald-300')}>{provisionStatus}</span>}
            {deploy.isError && <span className="text-xs text-rose-400">Failed — try again</span>}
            <Button type="submit" onClick={onSubmit} disabled={!canNext || deploy.isPending}>
              {step === STEPS.length - 1 ? (deploy.isPending ? 'Deploying…' : <><Rocket size={15} /> Deploy</>) : <>Continue <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
  return wizardContent;
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>{children}</div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2"><span className="text-xs text-slate-500">{label}</span><span className="max-w-[60%] truncate font-medium text-slate-200">{value}</span></div>;
}
