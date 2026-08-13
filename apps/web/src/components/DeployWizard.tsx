import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus, Rocket, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Template } from '@ninedeploy/sdk';
import { api } from '../lib/api.js';
import { Button, Input, Select, cn } from './ui.js';

const STEPS = ['Source', 'Runtime', 'Environment', 'Resources', 'Review'];

interface EnvRow { key: string; value: string; secret: boolean }

export function DeployWizard({ template, onClose }: { template?: Template; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.sources.list() });

  const [step, setStep] = useState(0);
  const [name, setName] = useState(template?.name ?? '');
  const [type, setType] = useState<'docker' | 'pm2'>('docker');
  const [mode, setMode] = useState<'repo' | 'image'>(template ? 'image' : 'repo');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [sourceId, setSourceId] = useState('');
  const [image, setImage] = useState(template?.image ?? '');
  const [port, setPort] = useState(template ? String(template.port) : '');
  const [volumeMount, setVolumeMount] = useState(template?.volumeMount ?? '');
  const [healthPath, setHealthPath] = useState('/');
  const [cpuShares, setCpuShares] = useState('');
  const [memLimitMb, setMemLimitMb] = useState('');
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    (template?.env ?? []).map((e) => ({ key: e.key, value: e.value, secret: e.secret ?? false })),
  );

  const deploy = useMutation({
    mutationFn: async () => {
      const svc = await api.services.create({
        name,
        type,
        repoUrl: mode === 'repo' ? repoUrl : undefined,
        image: mode === 'image' ? image : undefined,
        branch,
        sourceId: sourceId ? Number(sourceId) : undefined,
        port: port ? Number(port) : undefined,
        volumeMount: volumeMount || undefined,
        healthPath: healthPath || undefined,
        cpuShares: cpuShares ? Number(cpuShares) : undefined,
        memLimitMb: memLimitMb ? Number(memLimitMb) : undefined,
      });
      for (const e of envRows) {
        if (e.key.trim()) await api.env.create(svc.id, { key: e.key, value: e.value, isSecret: e.secret });
      }
      await api.deploys.trigger(svc.id);
      return svc;
    },
    onSuccess: (svc) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      navigate(`/services/${svc.id}`);
      onClose();
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div className="nd-fade flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header + stepper */}
        <div className="border-b border-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Rocket size={18} className="text-indigo-400" /> {template ? `Deploy ${template.name}` : 'New service'}
            </h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"><X size={16} /></button>
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
          {/* Step 1: Source */}
          {step === 0 && (
            <div className="space-y-4">
              <L label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" /></L>
              <div className="grid grid-cols-2 gap-3">
                <L label="Type">
                  <Select value={type} onChange={(e) => setType(e.target.value as 'docker' | 'pm2')}>
                    <option value="docker">Docker</option>
                    <option value="pm2">PM2</option>
                  </Select>
                </L>
                <L label="Source type">
                  <div className="flex h-10 items-center gap-1 rounded-lg bg-black/30 p-1 ring-1 ring-inset ring-white/10">
                    {(['repo', 'image'] as const).map((m) => (
                      <button key={m} type="button" onClick={() => setMode(m)} className={cn('flex-1 rounded-md py-1 text-xs font-medium transition', mode === m ? 'bg-indigo-500 text-white' : 'text-slate-400')}>{m === 'repo' ? 'Git repo' : 'Image'}</button>
                    ))}
                  </div>
                </L>
              </div>
              {mode === 'repo' ? (
                <>
                  <L label="Repository URL"><Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/you/repo" className="font-mono text-xs" /></L>
                  <div className="grid grid-cols-2 gap-3">
                    <L label="Branch"><Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" /></L>
                    <L label="Source (private)"><Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                      <option value="">Public / none</option>
                      {sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select></L>
                  </div>
                </>
              ) : (
                <L label="Image"><Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="n8nio/n8n" className="font-mono text-xs" /></L>
              )}
            </div>
          )}

          {/* Step 2: Runtime */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <L label="Port (host)"><Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" /></L>
                <L label="Persistent volume (container path)"><Input value={volumeMount} onChange={(e) => setVolumeMount(e.target.value)} placeholder="/app/data" className="font-mono text-xs" /></L>
              </div>
              <L label="Health check path"><Input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/" className="font-mono text-xs" /></L>
              <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-500">Leave volume empty for ephemeral storage. Health check probes this path to verify the app is up.</p>
            </div>
          )}

          {/* Step 3: Environment */}
          {step === 2 && (
            <div className="space-y-2">
              {envRows.length === 0 && <p className="py-2 text-xs text-slate-600">No environment variables.</p>}
              {envRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={row.key} onChange={(e) => setEnv(i, { key: e.target.value })} placeholder="KEY" className="h-9 w-32 font-mono text-xs" />
                  <Input value={row.value} onChange={(e) => setEnv(i, { value: e.target.value })} placeholder="value" type={row.secret ? 'password' : 'text'} className="h-9 flex-1 font-mono text-xs" />
                  <button type="button" onClick={() => setEnv(i, { secret: !row.secret })} className={cn('rounded px-2 py-1 text-[10px] uppercase', row.secret ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-slate-500')} title="Toggle secret">sec</button>
                  <button type="button" onClick={() => setEnvRows((r) => r.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-rose-400"><X size={14} /></button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setEnvRows((r) => [...r, { key: '', value: '', secret: false }])}><Plus size={13} /> Add variable</Button>
            </div>
          )}

          {/* Step 4: Resources */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <L label="CPU shares (0 = unlimited)"><Input value={cpuShares} onChange={(e) => setCpuShares(e.target.value)} placeholder="512" className="font-mono text-xs" /></L>
                <L label="Memory limit MB (0 = unlimited)"><Input value={memLimitMb} onChange={(e) => setMemLimitMb(e.target.value)} placeholder="256" className="font-mono text-xs" /></L>
              </div>
              <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-500">Optional caps applied when the container starts.</p>
            </div>
          )}

          {/* Step 5: Review */}
          {step === 4 && (
            <div className="space-y-2 text-sm">
              <Row label="Name" value={name} />
              <Row label="Type" value={type} />
              <Row label={mode === 'repo' ? 'Repository' : 'Image'} value={mode === 'repo' ? repoUrl : image} />
              {port && <Row label="Port" value={`:${port}`} />}
              {volumeMount && <Row label="Volume" value={volumeMount} />}
              <Row label="Env vars" value={String(envRows.filter((e) => e.key.trim()).length)} />
              <Row label="Limits" value={cpuShares || memLimitMb ? `${cpuShares || '—'} shares · ${memLimitMb || '—'} MB` : 'none'} />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 p-4">
          <Button type="button" variant="ghost" size="sm" onClick={back} className={cn(step === 0 && 'invisible')}><ArrowLeft size={14} /> Back</Button>
          <div className="flex items-center gap-3">
            {deploy.isError && <span className="text-xs text-rose-400">Failed — try again</span>}
            <Button type="submit" onClick={onSubmit} disabled={!canNext || deploy.isPending}>
              {step === STEPS.length - 1 ? (deploy.isPending ? 'Deploying…' : <><Rocket size={15} /> Deploy</>) : <>Continue <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>{children}</div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2"><span className="text-xs text-slate-500">{label}</span><span className="max-w-[60%] truncate font-medium text-slate-200">{value || '—'}</span></div>;
}
