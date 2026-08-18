import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { useDeployLogs } from '../../lib/useDeployLogs.js';
import { PipelineStepper, type StageId } from '../../components/PipelineStepper.js';

/** Terminal-style live deploy log with visual stage stepper and auto-scroll. */
export function LogPanel({
  serviceId,
  deploymentId,
  deployStatus,
}: {
  serviceId: number;
  deploymentId: number | null;
  deployStatus?: string;
}) {
  const { lines, open } = useDeployLogs(serviceId, deploymentId);
  const ref = useRef<HTMLPreElement>(null);
  useAutoScroll(ref, lines);
  const empty = useMemo(() => deploymentId == null, [deploymentId]);

  const handleStageClick = (stageId: StageId) => {
    if (!ref.current || !lines) return;
    const stageMarker = `##[stage:${stageId}:`;
    const lineIndex = lines.split('\n').findIndex((l) => l.includes(stageMarker));
    if (lineIndex >= 0) {
      const lineHeight = 20;
      ref.current.scrollTop = lineIndex * lineHeight;
    }
  };

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 py-16 text-center text-sm text-slate-600">
        Trigger a deploy to see live logs.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PipelineStepper
        rawLogs={lines}
        deployStatus={deployStatus}
        onStageClick={handleStageClick}
      />

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#090b11] shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.015] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            <span className="ml-2 font-mono text-[11px] text-slate-400">deployment-{deploymentId}.log</span>
          </div>
          <span className={open ? 'flex items-center gap-1.5 text-[10px] text-emerald-400' : 'flex items-center gap-1.5 text-[10px] text-slate-500'}>
            <span className={open ? 'h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse' : 'h-1.5 w-1.5 rounded-full bg-slate-600'} />
            {open ? 'Following live output' : 'Stream closed'}
          </span>
        </div>
        <pre ref={ref} className="h-[26rem] overflow-auto p-4 font-mono text-xs leading-5 text-slate-300 selection:bg-blue-500/30">
          {lines || (open ? '' : 'Connecting…')}
        </pre>
      </div>
    </div>
  );
}

function useAutoScroll(ref: RefObject<HTMLPreElement | null>, content: string): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on content — scroll to the newest line whenever a new log line arrives, even though the body only touches the DOM node.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, ref]);
}
