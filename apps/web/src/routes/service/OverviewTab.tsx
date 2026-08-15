import { useQuery } from '@tanstack/react-query';
import { Cpu, MemoryStick } from 'lucide-react';
import type { Service } from '@ninedeploy/sdk';
import { api } from '../../lib/api.js';
import { Sparkline } from '../../components/Sparkline.js';
import { Card, CardBody } from '../../components/ui.js';

/** Health, metrics and runtime metadata for one service. */
export function OverviewTab({ serviceId, svc }: { serviceId: number; svc: Service }) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
      <MetricsCard serviceId={serviceId} />
      <RuntimeInfoCard svc={svc} />
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
function RuntimeInfoCard({ svc }: { svc: Service }) {
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
