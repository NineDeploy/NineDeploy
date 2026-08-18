import { CheckCircle2, Circle, Clock, Flame, Globe, Layers, Loader2, RefreshCw, Server, ShieldCheck, XCircle } from 'lucide-react';
import type React from 'react';
import { useMemo } from 'react';
import { cn } from './ui.js';

export type StageId = 'PREPARE' | 'BUILD' | 'BOOT' | 'HEALTHCHECK' | 'PROXY_SWAP' | 'CLEANUP' | 'COMPLETE';
export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface PipelineStageInfo {
  id: StageId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  status: StageStatus;
  detail?: string;
}

const STAGE_DEFS: Array<Omit<PipelineStageInfo, 'status' | 'detail'>> = [
  { id: 'PREPARE', label: 'Hazırlık', description: 'Workspace & Repo Checkout', icon: Layers },
  { id: 'BUILD', label: 'Derleme', description: 'Dockerfile / Nixpacks Build', icon: Flame },
  { id: 'BOOT', label: 'Container', description: 'İzole Sandbox Başlatma', icon: Server },
  { id: 'HEALTHCHECK', label: 'Healthcheck', description: 'HTTP Probe & Doğrulama', icon: ShieldCheck },
  { id: 'PROXY_SWAP', label: 'Traffic Shift', description: 'Traefik Canlı Rota Değişimi', icon: RefreshCw },
  { id: 'CLEANUP', label: 'Temizlik', description: 'Eski Container Graceful Stop', icon: Clock },
  { id: 'COMPLETE', label: 'Canlı', description: 'Sıfır Kesintiyle Yayında', icon: Globe },
];

export function parsePipelineStages(rawLogs: string, deployStatus?: string): PipelineStageInfo[] {
  const isFinalSuccess = deployStatus === 'running';
  const isFailed = deployStatus === 'failed';
  const isCancelled = deployStatus === 'cancelled';

  const stagesState: Record<StageId, { status: StageStatus; detail?: string }> = {
    PREPARE: { status: isFinalSuccess ? 'success' : 'pending' },
    BUILD: { status: isFinalSuccess ? 'success' : 'pending' },
    BOOT: { status: isFinalSuccess ? 'success' : 'pending' },
    HEALTHCHECK: { status: isFinalSuccess ? 'success' : 'pending' },
    PROXY_SWAP: { status: isFinalSuccess ? 'success' : 'pending' },
    CLEANUP: { status: isFinalSuccess ? 'success' : 'pending' },
    COMPLETE: { status: isFinalSuccess ? 'success' : 'pending' },
  };

  const lines = rawLogs.split('\n');
  let currentRunningStage: StageId | null = null;

  for (const line of lines) {
    const match = line.match(/##\[stage:([A-Z_]+):(running|success|failed)\](?:\s+(.*))?/);
    if (match) {
      const stageName = match[1] as StageId;
      const stageStatus = match[2] as StageStatus;
      const detail = match[3] || undefined;

      if (stageName === ('ERROR' as any)) {
        if (currentRunningStage && stagesState[currentRunningStage]) {
          stagesState[currentRunningStage].status = 'failed';
          stagesState[currentRunningStage].detail = detail || 'Aşama başarısız oldu';
        }
        continue;
      }

      if (stagesState[stageName]) {
        stagesState[stageName].status = stageStatus;
        if (detail) stagesState[stageName].detail = detail;
        if (stageStatus === 'running') {
          currentRunningStage = stageName;
        } else if (stageStatus === 'success' && currentRunningStage === stageName) {
          currentRunningStage = null;
        }
      }
    }
  }

  // If failed and no explicit stage failed, mark the running stage as failed
  if ((isFailed || isCancelled) && currentRunningStage && stagesState[currentRunningStage]) {
    stagesState[currentRunningStage].status = 'failed';
    stagesState[currentRunningStage].detail = isCancelled ? 'Dağıtım iptal edildi' : 'Hata oluştu';
  }

  return STAGE_DEFS.map((def) => ({
    ...def,
    status: stagesState[def.id]?.status ?? (isFinalSuccess ? 'success' : 'pending'),
    detail: stagesState[def.id]?.detail,
  }));
}

export function PipelineStepper({
  rawLogs,
  deployStatus,
  onStageClick,
}: {
  rawLogs: string;
  deployStatus?: string;
  onStageClick?: (stageId: StageId) => void;
}) {
  const stages = useMemo(() => parsePipelineStages(rawLogs, deployStatus), [rawLogs, deployStatus]);
  const isZeroDowntimeLive = deployStatus === 'running';

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0c0d14] p-4 shadow-lg">
      {/* Top Banner: Blue-Green Zero-Downtime Status */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <ShieldCheck size={16} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-200">Zero-Downtime Blue/Green Pipeline</h4>
            <p className="text-[11px] text-slate-400">
              {isZeroDowntimeLive
                ? 'Trafik kesintisiz olarak yeni sürüme aktarıldı (100% Traffic Shifted)'
                : deployStatus === 'failed'
                  ? 'Sağlık kontrolü başarısız ➔ Otomatik Rollback devreye alındı'
                  : 'Canlı sürüm kesintisiz hizmet vermeye devam ediyor, yeni container arka planda hazırlanıyor'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-medium text-blue-400 border border-blue-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            Traefik Routing
          </span>
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium border',
            isZeroDowntimeLive
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : deployStatus === 'failed'
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
          )}>
            {isZeroDowntimeLive ? 'Slot: Active (Live)' : deployStatus === 'failed' ? 'Slot: Rolled Back' : 'Slot: Staging'}
          </span>
        </div>
      </div>

      {/* Stepper Graphic */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {stages.map((st, index) => {
          const Icon = st.icon;
          const isPending = st.status === 'pending';
          const isRunning = st.status === 'running';
          const isSuccess = st.status === 'success';
          const isFailed = st.status === 'failed';

          return (
            <button
              key={st.id}
              type="button"
              onClick={() => onStageClick?.(st.id)}
              className={cn(
                'group relative flex flex-col items-start rounded-lg border p-2.5 text-left transition-all',
                isRunning && 'border-blue-500/50 bg-blue-500/[0.06] shadow-sm shadow-blue-500/10',
                isSuccess && 'border-emerald-500/30 bg-emerald-500/[0.04]',
                isFailed && 'border-rose-500/50 bg-rose-500/[0.06]',
                isPending && 'border-white/[0.04] bg-white/[0.01] opacity-60 hover:opacity-100',
              )}
            >
              <div className="mb-2 flex w-full items-center justify-between">
                <div className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-md text-xs',
                  isRunning && 'bg-blue-500/20 text-blue-400',
                  isSuccess && 'bg-emerald-500/20 text-emerald-400',
                  isFailed && 'bg-rose-500/20 text-rose-400',
                  isPending && 'bg-white/5 text-slate-500',
                )}>
                  <Icon size={13} />
                </div>

                <span className="text-[10px] font-mono text-slate-500">
                  0{index + 1}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {isRunning && <Loader2 size={12} className="animate-spin text-blue-400" />}
                {isSuccess && <CheckCircle2 size={12} className="text-emerald-400" />}
                {isFailed && <XCircle size={12} className="text-rose-400" />}
                {isPending && <Circle size={12} className="text-slate-600" />}
                <span className={cn(
                  'text-xs font-semibold',
                  isRunning && 'text-blue-300',
                  isSuccess && 'text-emerald-300',
                  isFailed && 'text-rose-300',
                  isPending && 'text-slate-400',
                )}>
                  {st.label}
                </span>
              </div>

              <p className="mt-1 text-[10px] text-slate-400 leading-tight">
                {st.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
