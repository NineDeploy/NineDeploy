import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, GitCompare, RotateCcw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Deployment } from '@ninedeploy/sdk';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Card, CardBody, Skeleton, Spinner, StatusBadge, cn } from '../../components/ui.js';
import { LogPanel } from './LogPanel.js';

export const IN_FLIGHT = ['queued', 'building', 'deploying'];

/**
 * A deployment can be removed from history once it is finished AND is not the
 * one serving traffic. The server enforces both (and the `admin` role); this
 * only decides whether to offer the button.
 */
export const isRemovable = (status: string): boolean => !IN_FLIGHT.includes(status) && status !== 'running';

/** Deployment history + the live build log for the selected deployment. */
export function DeploysTab({
  serviceId,
  deploys,
  loading,
  activeId,
  onSelect,
}: {
  serviceId: number;
  deploys: Deployment[];
  loading: boolean;
  activeId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const activeDeployRow = deploys.find((d) => d.id === activeId) ?? null;
  const inFlight = !!activeDeployRow && IN_FLIGHT.includes(activeDeployRow.status);

  const rollback = useMutation({
    mutationFn: (depId: number) => api.deploys.rollback(serviceId, depId),
    onSuccess: (res) => {
      onSelect(res.deploymentId);
      qc.invalidateQueries({ queryKey: ['deploys', serviceId] });
      qc.invalidateQueries({ queryKey: ['service', serviceId] });
      toast('Rollback started', 'info');
    },
    onError: () => toast('Rollback failed', 'error'),
  });

  const cancelDeploy = useMutation({
    mutationFn: (depId: number) => api.deploys.cancel(serviceId, depId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deploys', serviceId] });
      toast('Deployment cancelled', 'info');
    },
    onError: () => toast('Cancel failed', 'error'),
  });

  const removeDeploy = useMutation({
    mutationFn: (depId: number) => api.deploys.remove(serviceId, depId),
    onSuccess: (_res, depId) => {
      // The removed row may be the one whose log is on screen; drop the
      // selection rather than leave the panel pointed at a deployment that no
      // longer exists.
      if (depId === activeId) onSelect(null);
      qc.invalidateQueries({ queryKey: ['deploys', serviceId] });
      toast('Deployment removed', 'info');
    },
    // The server refuses an in-flight deploy and the live one with a specific
    // reason; showing it beats a generic failure toast.
    onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Remove failed', 'error'),
  });

  return (
    <div className="mt-5 space-y-5">
      <DeploymentsCard
        deploys={deploys}
        activeId={activeId}
        onSelect={onSelect}
        onRollback={(depId) => {
          rollback.mutate(depId);
          onSelect(null);
        }}
        onCancel={(depId) => cancelDeploy.mutate(depId)}
        onRemove={(depId) => removeDeploy.mutate(depId)}
        loading={loading}
      />

      <Card>
        <CardBody className="flex h-full flex-col">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-slate-400">
                <Activity size={15} />
              </span>
              <div>
                <div className="text-sm font-medium text-slate-200">Deployment output</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {activeDeployRow
                    ? `Deployment #${activeDeployRow.id} · ${activeDeployRow.commitSha?.slice(0, 7) ?? 'no commit'}`
                    : 'Select a deployment to inspect its output'}
                </div>
              </div>
            </div>
            {inFlight && (
              <span className="flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-300">
                <Spinner className="h-3 w-3" /> Live deployment
              </span>
            )}
          </div>
          <LogPanel
            serviceId={serviceId}
            deploymentId={activeId}
            deployStatus={activeDeployRow?.status}
          />
        </CardBody>
      </Card>

      {activeId && !inFlight && <ConfigDiffCard serviceId={serviceId} deploymentId={activeId} />}
    </div>
  );
}

// ── Config diff vs the previous deployment ────────────────────────────────
function ConfigDiffCard({ serviceId, deploymentId }: { serviceId: number; deploymentId: number }) {
  const [open, setOpen] = useState(false);
  const diff = useQuery({
    queryKey: ['deploy-diff', serviceId, deploymentId],
    queryFn: () => api.deploys.configDiff(serviceId, deploymentId),
    enabled: open,
  });

  return (
    <Card>
      <CardBody>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-300"
        >
          <span className="flex items-center gap-2">
            <GitCompare size={15} className="text-slate-500" /> Config diff vs previous deploy
          </span>
          <span className="text-xs text-slate-500">{open ? 'hide' : 'show'}</span>
        </button>
        {open && (
          <div className="mt-3">
            {diff.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : !diff.data ? (
              <p className="text-xs text-slate-600">No snapshot.</p>
            ) : diff.data.previousDeploymentId === null ? (
              <p className="text-xs text-slate-600">First recorded deployment — nothing to compare against.</p>
            ) : !diff.data.changed ? (
              <p className="text-xs text-slate-500">
                No changes against #{diff.data.previousDeploymentId} — same build config and env keys.
              </p>
            ) : (
              <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
                {diff.data.diff.split('\n').map((line) => (
                  <span
                    key={line}
                    className={cn(
                      'block whitespace-pre',
                      line.startsWith('+ ') ? 'text-emerald-300' : line.startsWith('- ') ? 'text-rose-300' : 'text-slate-500',
                    )}
                  >
                    {line}
                  </span>
                ))}
              </pre>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Deployments ───────────────────────────────────────────────────────────
function DeploymentsCard({
  deploys,
  activeId,
  onSelect,
  onRollback,
  onCancel,
  onRemove,
  loading,
}: {
  deploys: Deployment[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onRollback?: (deploymentId: number) => void;
  onCancel?: (deploymentId: number) => void;
  onRemove?: (deploymentId: number) => void;
  loading: boolean;
}) {
  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-300">Deployments</div>
            <p className="mt-0.5 text-[11px] text-slate-600">Select a release to inspect its pipeline and output.</p>
          </div>
          {deploys.length > 0 && <span className="text-[11px] text-slate-600">{deploys.length} total</span>}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-full" />
        ) : deploys.length === 0 ? (
          <p className="py-2 text-xs text-slate-600">No deployments yet.</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {deploys.map((d, i) => {
              const duration =
                d.startedAt && d.finishedAt
                  ? Math.max(1, Math.round((new Date(d.finishedAt).getTime() - new Date(d.startedAt).getTime()) / 1000))
                  : null;
              return (
                <li key={d.id} className="group flex min-w-[15rem] items-center gap-1">
                  <button type="button"
                    onClick={() => onSelect(d.id)}
                    className={cn(
                      'flex flex-1 items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition',
                      d.id === activeId
                        ? 'border-blue-500/30 bg-blue-500/[0.08]'
                        : 'border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]',
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
                    <button type="button"
                      onClick={() => onCancel(d.id)}
                      className="shrink-0 rounded p-1.5 text-slate-500 opacity-0 transition hover:bg-white/5 hover:text-amber-300 group-hover:opacity-100"
                      title={`Cancel deployment #${d.id}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                  {onRollback && i > 0 && !IN_FLIGHT.includes(d.status) && d.status !== 'failed' && d.status !== 'cancelled' && (
                    <button type="button"
                      onClick={() => onRollback(d.id)}
                      className="shrink-0 rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-white/5 hover:text-indigo-300 group-hover:opacity-100"
                      title={`Rollback to #${d.id}`}
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                  {onRemove && isRemovable(d.status) && (
                    <button type="button"
                      onClick={() => onRemove(d.id)}
                      className="shrink-0 rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-white/5 hover:text-rose-300 group-hover:opacity-100"
                      title={`Remove deployment #${d.id} from history`}
                      aria-label={`Remove deployment #${d.id}`}
                    >
                      <Trash2 size={12} />
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

