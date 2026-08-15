import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, X } from 'lucide-react';
import type { Deployment } from '@ninedeploy/sdk';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Card, CardBody, Skeleton, Spinner, StatusBadge, cn } from '../../components/ui.js';
import { LogPanel } from './LogPanel.js';

export const IN_FLIGHT = ['queued', 'building', 'deploying'];

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

  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
      <div className="space-y-5 lg:col-span-2">
        <DeploymentsCard
          deploys={deploys}
          activeId={activeId}
          onSelect={onSelect}
          onRollback={(depId) => {
            rollback.mutate(depId);
            onSelect(null);
          }}
          onCancel={(depId) => cancelDeploy.mutate(depId)}
          loading={loading}
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
          <LogPanel serviceId={serviceId} deploymentId={activeId} />
        </CardBody>
      </Card>
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
  deploys: Deployment[];
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

