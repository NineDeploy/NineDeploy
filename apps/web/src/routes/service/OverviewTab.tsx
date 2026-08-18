import { useQuery } from '@tanstack/react-query';
import { Activity, Cpu, HardDrive, MemoryStick, Terminal } from 'lucide-react';
import { Link } from 'react-router';
import type { Service } from '@ninedeploy/sdk';
import { api } from '../../lib/api.js';
import { Sparkline } from '../../components/Sparkline.js';
import { Card, CardBody, StatusBadge } from '../../components/ui.js';

/** Health, metrics and runtime metadata for one service. */
export function OverviewTab({ serviceId, svc }: { serviceId: number; svc: Service }) {
  return (
    <div className="mt-5 space-y-5">
      {/* Top Quick Status & Metrics Bar */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MetricsCard serviceId={serviceId} />
        <RuntimeInfoCard svc={svc} />
      </div>

      {/* Deployment & Logs Quick Access Card */}
      <DeploymentQuickCard serviceId={serviceId} />
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
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-indigo-400" />
            <span className="text-sm font-semibold text-slate-100">Live Resource Telemetry</span>
          </div>
          <span className="rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-400">
            Last 60m
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400 font-medium">
                <Cpu size={13} className="text-indigo-400" /> CPU Load
              </span>
              <span className="font-mono text-xs font-semibold text-slate-100">
                {latest(cpu.data) != null ? `${latest(cpu.data)}%` : '—'}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg">
              <Sparkline points={(cpu.data?.points ?? []).map((p) => p.value)} color="#818cf8" width={220} height={44} />
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-400 font-medium">
                <MemoryStick size={13} className="text-emerald-400" /> Memory Usage
              </span>
              <span className="font-mono text-xs font-semibold text-slate-100">
                {latest(mem.data) != null ? `${latest(mem.data)} MiB` : '—'}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg">
              <Sparkline points={(mem.data?.points ?? []).map((p) => p.value)} color="#34d399" width={220} height={44} />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Runtime metadata ───────────────────────────────────────────────────────
function RuntimeInfoCard({ svc }: { svc: Service }) {
  const rows: Array<[string, string]> = [
    ['Status', svc.status],
    ['Runtime Container', svc.runtimeId ?? 'not deployed'],
    ['Commit SHA', svc.commitSha ? svc.commitSha.slice(0, 12) : '—'],
    ['Base Image', svc.image ?? '—'],
    ['Internal Port', svc.port ? `:${svc.port}` : '—'],
    ['Health Endpoint', svc.healthPath || '/'],
    ['CPU Limit', svc.cpuShares ? `${svc.cpuShares} shares` : 'unlimited'],
    ['Memory Limit', svc.memLimitMb ? `${svc.memLimitMb} MiB` : 'unlimited'],
  ];

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-emerald-400" />
            <span className="text-sm font-semibold text-slate-100">Runtime & Architecture</span>
          </div>
          <StatusBadge status={svc.status} />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2 flex items-center justify-between">
              <dt className="text-slate-400 text-[11px] font-medium">{k}</dt>
              <dd className="truncate font-mono text-[11px] text-slate-200" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

// ── Deployment Quick Card ─────────────────────────────────────────────────
function DeploymentQuickCard({ serviceId }: { serviceId: number }) {
  const deploys = useQuery({
    queryKey: ['service-deploys', serviceId],
    queryFn: () => api.deploys.list(serviceId),
  });

  const latestDeploy = deploys.data?.[0];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal size={15} className="text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Latest Deployment</span>
          </div>
          {latestDeploy && (
            <span className="font-mono text-[11px] text-slate-500">
              Trigger: {latestDeploy.trigger}
            </span>
          )}
        </div>

        {latestDeploy ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusBadge status={latestDeploy.status} />
                <span className="font-mono text-xs text-slate-200">
                  {latestDeploy.commitSha ? `Commit ${latestDeploy.commitSha.slice(0, 7)}` : 'Manual Build'}
                </span>
              </div>
              <p className="text-xs text-slate-400">{latestDeploy.message || 'Deployment triggered'}</p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                to={`/services/${serviceId}?tab=logs`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.08] transition"
              >
                <Terminal size={13} /> View Live Logs &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <p className="py-2 text-xs text-slate-500">No deployments yet for this service.</p>
        )}
      </CardBody>
    </Card>
  );
}
