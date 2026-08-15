import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { useDeployLogs } from '../../lib/useDeployLogs.js';

/** Terminal-style live deploy log with auto-scroll. */
export function LogPanel({ serviceId, deploymentId }: { serviceId: number; deploymentId: number | null }) {
  const { lines, open } = useDeployLogs(serviceId, deploymentId);
  const ref = useRef<HTMLPreElement>(null);
  useAutoScroll(ref, lines);
  const empty = useMemo(() => deploymentId == null, [deploymentId]);

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 py-16 text-center text-sm text-slate-600">
        Trigger a deploy to see live logs.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a10]">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-2 font-mono text-[11px] text-slate-500">deploy #{deploymentId}</span>
      </div>
      <pre ref={ref} className="h-[22rem] overflow-auto p-3 font-mono text-xs leading-relaxed text-slate-300">
        {lines || (open ? '' : 'Connecting…')}
      </pre>
    </div>
  );
}

function useAutoScroll(ref: RefObject<HTMLPreElement | null>, content: string): void {
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, ref]);
}
