import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { Clock, Copy, GitBranch, Plus, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useCopy } from '../../lib/format.js';
import { AttachmentsCard } from '../../components/AttachmentsCard.js';
import { EnvCard } from '../../components/EnvCard.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Input, Skeleton, cn } from '../../components/ui.js';
import { SecretRow } from './SecretRow.js';

/** Environment variables, auto-deploy webhooks, file attachments and cron jobs. */
export function EnvironmentTab({ serviceId }: { serviceId: number }) {
  return (
    <div className="mt-5 grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <EnvCard serviceId={serviceId} />
        <WebhooksCard serviceId={serviceId} />
      </div>
      <div className="space-y-5">
        <AttachmentsCard serviceId={serviceId} />
        <JobsCard serviceId={serviceId} />
      </div>
    </div>
  );
}

// ── Webhooks ──────────────────────────────────────────────────────────────
function WebhooksCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null);
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

  const { copy } = useCopy();

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
            <SecretRow label="Payload URL" value={revealed.url} />
            <SecretRow label="Secret" value={revealed.secret} />
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
                    onClick={() => void copy(w.url)}
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
