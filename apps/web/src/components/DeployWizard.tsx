import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Download, GitBranch, Globe, Hammer, HeartPulse, Play, Plus, Rocket, Sparkles, Terminal, Wand2, X, Zap } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { RepoInsights, Template } from '@ninedeploy/sdk';
import { api } from '../lib/api.js';
import { toInt } from '../lib/format.js';
import { useAuth } from '../lib/auth.js';
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
  const { user } = useAuth();
  // Compose and PM2 both execute on the host, so the API admits admins only.
  const isAdmin = user?.role === 'admin';
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

  // ── Repository analysis (framework detection) ─────────────────────────────
  // Auto-runs (debounced) once a valid repo URL + branch are present, so the
  // wizard can show a framework-aware deploy plan. Private repos need their
  // Git credential selected first — a failed analysis degrades to a hint, it
  // never blocks the deploy itself.
  const [insights, setInsights] = useState<RepoInsights | null>(null);
  // Root-level analysis is kept separately: switching the base directory to a
  // sub-app re-analyzes `insights` for that package, while the monorepo
  // package picker keeps rendering from the root result.
  const [rootInsights, setRootInsights] = useState<RepoInsights | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [installCmd, setInstallCmd] = useState('');
  const [buildCmd, setBuildCmd] = useState('');
  const [startCmd, setStartCmd] = useState('');
  // Monorepo flow: the same repo deployed N times, once per sub-app directory.
  const [baseDir, setBaseDir] = useState('');
  const lastAnalyzedRef = useRef('');

  const trimmedBaseDir = baseDir.trim();
  const isRootScope = trimmedBaseDir === '' || trimmedBaseDir === '/';

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await api.insights.analyze({
        repoUrl,
        branch,
        ...(trimmedBaseDir ? { baseDir: trimmedBaseDir } : {}),
        ...(sourceId && Number(sourceId) > 0 ? { sourceId: Number(sourceId) } : {}),
      });
      setInsights(result);
      if (isRootScope) setRootInsights(result);
      lastAnalyzedRef.current = `${repoUrl}|${branch}|${trimmedBaseDir}`;
      setSuggestionsApplied(false);
    } catch (err) {
      setInsights(null);
      setAnalyzeError(err instanceof Error ? err.message : 'Could not analyze the repository');
    } finally {
      setAnalyzing(false);
    }
  }, [repoUrl, branch, sourceId, trimmedBaseDir, isRootScope]);

  useEffect(() => {
    if (template || mode !== 'repo' || !repoUrl.trim() || !/^https?:\/\//i.test(repoUrl.trim())) return;
    const key = `${repoUrl}|${branch}|${baseDir.trim()}`;
    if (key === lastAnalyzedRef.current) return;
    // Immediately drop stale results for a different repo/branch; the analysis
    // itself fires after the user stops typing.
    setInsights(null);
    setAnalyzeError(null);
    const t = setTimeout(() => void runAnalyze(), 900);
    return () => clearTimeout(t);
  }, [repoUrl, branch, baseDir, mode, template, runAnalyze]);

  /** Copy the detected preset into the form: port, suggested env vars and the
   * build commands that travel with the create-service request. */
  const applySuggestions = () => {
    if (!insights) return;
    const f = insights.framework;
    setPort(String(f.port));
    if (f.installCmd) setInstallCmd(f.installCmd);
    if (f.buildCmd) setBuildCmd(f.buildCmd);
    if (f.startCmd) setStartCmd(f.startCmd);
    setEnvRows((rows) => {
      const existing = new Set(rows.map((r) => r.key));
      const suggested = f.env.filter((e) => !existing.has(e.key)).map((e) => ({ key: e.key, value: e.value, secret: false }));
      return suggested.length > 0 ? [...rows, ...suggested] : rows;
    });
    setSuggestionsApplied(true);
  };

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
    mutationFn: async (vars?: { quick?: boolean }) => {
      if (template) {
        const input = {
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
        };
        // Preparing is itself the durable queue operation. The worker owns all
        // dependency provisioning, so navigation/network loss cannot strand it.
        const prepared = await api.templates.prepare(template.id, input);
        return { serviceId: prepared.serviceId, deploymentId: prepared.deploymentId, canonical: true, background: false };
      }
      // Quick Deploy with a successful analysis merges the detected preset
      // directly into the request (the setState in applySuggestions cannot be
      // observed by this closure in the same tick). Advanced flow relies on
      // the form state filled by the Apply button.
      const quick = vars?.quick === true && mode === 'repo' && insights != null;
      const f = quick ? insights.framework : null;
      const effectivePort = f ? f.port : toInt(port);
      const effectiveEnvRows = f
        ? [
            ...envRows,
            ...f.env
              .filter((e) => !envRows.some((r) => r.key === e.key))
              .map((e) => ({ key: e.key, value: e.value, secret: false })),
          ]
        : envRows;
      const cmdSource = f
        ? { install: f.installCmd, build: f.buildCmd, start: f.startCmd }
        : { install: installCmd || null, build: buildCmd || null, start: startCmd || null };
      const svc = await api.services.create({
        name,
        type,
        projectId: projectId ?? undefined,
        ...(serverId ? { serverId: toInt(serverId) } : {}),
        repoUrl: mode === 'repo' ? repoUrl : undefined,
        image: mode === 'image' ? image : undefined,
        branch,
        sourceId: toInt(sourceId),
        port: effectivePort,
        publishedPort: toInt(publishedPort),
        volumeMount: volumeMount || undefined,
        healthPath: healthPath || undefined,
        cpuShares: toInt(cpuShares),
        memLimitMb: toInt(memLimitMb),
        ...(trimmedBaseDir || cmdSource.install || cmdSource.build || cmdSource.start
          ? {
              build: {
                ...(trimmedBaseDir ? { baseDir: trimmedBaseDir } : {}),
                ...(cmdSource.install ? { installCmd: cmdSource.install } : {}),
                ...(cmdSource.build ? { buildCmd: cmdSource.build } : {}),
                ...(cmdSource.start ? { startCmd: cmdSource.start } : {}),
              },
            }
          : {}),
      });
      for (const e of effectiveEnvRows) {
        if (e.key.trim()) {
          await api.env.create(svc.id, {
            key: e.key,
            value: e.value,
            isSecret: e.secret,
          });
        }
      }
      const deployment = await api.deploys.trigger(svc.id);
      return { serviceId: svc.id, deploymentId: deployment.deploymentId, canonical: false, background: false };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['databases'] });
      toast(result.background ? 'Provisioning started — follow progress in Deployments' : 'Deploy started — building…', 'info');
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

  // H-3: a template that mounts the Docker socket is admin-only server-side.
  // Say so on the first screen rather than letting a member fill in five steps
  // and collect a 403 at the end.
  const adminOnlyTemplate = !isAdmin && template?.dockerSocket === true;

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) next();
    else deploy.mutate({});
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
          {adminOnlyTemplate && (
            <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] p-3 text-xs leading-relaxed text-rose-200">
              This template mounts the Docker socket, which grants control of every container on the host. Only an administrator can deploy it.
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
                    {isAdmin && <option value="compose">Compose</option>}
                    {isAdmin && <option value="pm2">PM2</option>}
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

                  {/* Which credential private-repo cloning will use — say so
                      before the deploy, not as a failed clone later. */}
                  <div
                    className={cn(
                      'rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
                      sourceId
                        ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-slate-300'
                        : repoUrl.trim()
                          ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200/90'
                          : 'border-white/[0.06] bg-white/[0.02] text-slate-400',
                    )}
                  >
                    {sourceId ? (
                      <>
                        Cloning, framework analysis and webhook auto-deploys run with credential{' '}
                        <span className="font-medium text-emerald-300">
                          {sources.data?.find((s) => String(s.id) === sourceId)?.name ?? `#${sourceId}`}
                        </span>
                        {remoteRepos.data?.some((r) => r.url === repoUrl && r.isPrivate) && (
                          <> — this repository is <span className="font-medium">private</span></>
                        )}
                        .
                      </>
                    ) : repoUrl.trim() ? (
                      <>
                        No Git credential selected — public repositories deploy fine, but a{' '}
                        <span className="font-medium">private</span> repository will fail to clone at deploy time. Select
                        one above
                        {!isAdmin && ' (ask an administrator if none is listed)'}.
                      </>
                    ) : (
                      <>
                        Private repository? Select a Git credential first — it is used for cloning, analysis and webhook
                        auto-deploys. Credentials are created by admins under{' '}
                        <span className="font-medium text-slate-300">System → Sources</span> and stored encrypted; the
                        token itself is never shown again.
                      </>
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

                  {/* Framework detection + detailed deploy plan for this repo */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Repository analysis</span>
                      {insights && !analyzing && (
                        <button type="button" onClick={() => void runAnalyze()} className="text-[11px] text-indigo-300 hover:text-indigo-200 transition">
                          Re-analyze
                        </button>
                      )}
                    </div>

                    {analyzing && (
                      <div className="flex items-center gap-2.5 text-xs text-slate-400">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-400/40 border-t-indigo-400" />
                        Analyzing repository (clone + framework detection)…
                      </div>
                    )}

                    {!analyzing && !insights && analyzeError && (
                      <div className="space-y-1.5 text-xs leading-relaxed text-amber-200/90">
                        <p>{analyzeError}</p>
                        <p className="text-slate-500">Private repositories need a Git credential with access selected above — or continue without analysis.</p>
                      </div>
                    )}

                    {!analyzing && !insights && !analyzeError && (
                      <p className="text-xs text-slate-500">
                        Framework detection runs automatically once a repository URL and branch are selected.
                      </p>
                    )}

                    {!analyzing && insights && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg leading-none">{insights.framework.emoji}</span>
                          <span className="text-sm font-semibold text-slate-100">
                            {insights.framework.name}
                            {insights.frameworkVersion && <span className="ml-1 font-mono text-xs text-slate-400">{insights.frameworkVersion}</span>}
                          </span>
                          {!isRootScope && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/25">
                              {trimmedBaseDir}
                            </span>
                          )}
                          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300 ring-1 ring-inset ring-indigo-500/25">
                            {insights.framework.category}
                          </span>
                          {insights.packageManager && (
                            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-slate-300">{insights.packageManager}</span>
                          )}
                          {insights.nodeVersion && (
                            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-slate-300">Node {insights.nodeVersion}</span>
                          )}
                          {insights.hasDockerfile && (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20">Dockerfile</span>
                          )}
                          {insights.monorepo && (
                            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-slate-300">monorepo</span>
                          )}
                        </div>

                        <div className="space-y-1.5 rounded-lg bg-black/25 p-2.5">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Deploy pipeline for this repository</div>
                          <PlanStep icon={<GitBranch size={12} />} label="Clone & checkout" value={trimmedBaseDir ? `${branch} · ${trimmedBaseDir}` : branch} />
                          <PlanStep icon={<Download size={12} />} label="Install dependencies" value={insights.framework.installCmd} mono />
                          <PlanStep icon={<Hammer size={12} />} label="Build" value={insights.framework.buildCmd} mono />
                          <PlanStep icon={<Play size={12} />} label="Start server" value={insights.framework.startCmd ? `${insights.framework.startCmd} · :${insights.framework.port}` : null} mono />
                          <PlanStep icon={<HeartPulse size={12} />} label="Healthcheck" value={`GET ${healthPath}`} mono />
                          <PlanStep icon={<Globe size={12} />} label="Route traffic" value="Traefik router + auto URL" />
                        </div>

                        {insights.framework.env.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500">Suggested env:</span>
                            {insights.framework.env.map((e) => (
                              <span key={e.key} className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{e.key}</span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="text-[11px] text-slate-500">
                            {insights.dependencyCount + insights.devDependencyCount} packages
                            {insights.detectedFiles.length > 0 && ` · ${insights.detectedFiles.slice(0, 4).join(', ')}${insights.detectedFiles.length > 4 ? '…' : ''}`}
                          </span>
                          {suggestionsApplied ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                              <Check size={12} /> Suggestions applied
                            </span>
                          ) : (
                            <Button type="button" size="sm" variant="secondary" onClick={applySuggestions} className="h-7 text-xs">
                              <Wand2 size={12} /> Apply suggestions
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Monorepo: pick which sub-app this service deploys. Each
                        package becomes its own service (own port + domain),
                        all from the same repository. */}
                    {rootInsights?.monorepo && (
                      <div className="space-y-1.5 border-t border-white/[0.06] pt-2.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Monorepo packages — deploy each as its own service
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setBaseDir('')}
                            className={cn(
                              'rounded-full px-2.5 py-1 font-mono text-[10px] transition ring-1 ring-inset',
                              isRootScope
                                ? 'bg-indigo-500/20 text-indigo-200 ring-indigo-400/40'
                                : 'bg-white/[0.03] text-slate-400 ring-white/10 hover:text-slate-200',
                            )}
                          >
                            / (repo root)
                          </button>
                          {(rootInsights.workspacePackages ?? []).map((p) => {
                            const active = trimmedBaseDir === `/${p.dir}`;
                            return (
                              <button
                                key={p.dir}
                                type="button"
                                title={p.name ?? p.dir}
                                onClick={() => setBaseDir(`/${p.dir}`)}
                                className={cn(
                                  'rounded-full px-2.5 py-1 font-mono text-[10px] transition ring-1 ring-inset',
                                  active
                                    ? 'bg-indigo-500/20 text-indigo-200 ring-indigo-400/40'
                                    : 'bg-white/[0.03] text-slate-400 ring-white/10 hover:text-slate-200',
                                )}
                              >
                                /{p.dir}
                                {p.framework && <span className="ml-1 font-sans text-slate-500">· {p.framework}</span>}
                              </button>
                            );
                          })}
                          {(rootInsights.workspacePackages ?? []).length === 0 && (
                            <span className="text-[11px] text-slate-500">
                              workspace config found — type a base directory below to scope this service
                            </span>
                          )}
                        </div>
                        {!isRootScope && (
                          <p className="text-[11px] leading-relaxed text-indigo-200/80">
                            This service builds <span className="font-mono">{trimmedBaseDir}</span> only. Create sibling
                            services from the same repo with other directories, and give each an auto-deploy webhook with
                            watch path <span className="font-mono">{trimmedBaseDir}/**</span>.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Manual base-directory override (monorepo or not) */}
                  {(isAdvanced || rootInsights?.monorepo) && (
                    <L label="Base directory (build context)">
                      <Input
                        value={baseDir}
                        onChange={(e) => setBaseDir(e.target.value)}
                        placeholder="/ — repo root, or /apps/web for a monorepo sub-app"
                        className="font-mono text-xs"
                      />
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
                    disabled={!canNext || deploy.isPending || adminOnlyTemplate}
                    onClick={() => {
                      // Quick mode with a successful analysis: prefill the form
                      // for visibility AND let the mutation merge the preset
                      // (state set in this tick is not visible to its closure).
                      if (!template && mode === 'repo' && insights) applySuggestions();
                      deploy.mutate({ quick: true });
                    }}
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
              {trimmedBaseDir && mode === 'repo' && <Row label="Base directory" value={trimmedBaseDir} />}
              {insights && mode === 'repo' && (
                <Row
                  label="Detected framework"
                  value={`${insights.framework.emoji} ${insights.framework.name}${insights.frameworkVersion ? ` ${insights.frameworkVersion}` : ''}${insights.packageManager ? ` · ${insights.packageManager}` : ''}`}
                />
              )}
              {(installCmd || buildCmd || startCmd) && (
                <Row label="Build commands" value={[installCmd, buildCmd, startCmd].filter(Boolean).join('  →  ')} />
              )}
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
            <Button type="submit" onClick={onSubmit} disabled={!canNext || deploy.isPending || adminOnlyTemplate}>
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
/** One line of the framework-aware deploy pipeline preview. */
function PlanStep({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="shrink-0 text-slate-500">{icon}</span>
      <span className="w-32 shrink-0 text-slate-400">{label}</span>
      <span className={cn('truncate text-slate-200', mono && 'font-mono text-[10px]')} title={value ?? undefined}>
        {value ?? <span className="text-slate-600">—</span>}
      </span>
    </div>
  );
}
