import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getToken } from '../lib/api.js';

export function ContainerTerminal({ serviceId, onClose }: { serviceId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: { background: '#0a0a10', foreground: '#cbd5e1', cursor: '#6366f1' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();
    term.writeln('Connecting to container shell…');

    const token = getToken() ?? '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/v1/services/${serviceId}/exec?token=${token}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnected(true);
      term.clear();
    };
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
      else term.write(e.data as string);
    };
    ws.onclose = () => {
      setConnected(false);
      term.write('\r\n\x1b[31m*** Connection closed ***\x1b[0m\r\n');
    };
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      ws.close();
      term.dispose();
      window.removeEventListener('resize', onResize);
    };
  }, [serviceId]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a10]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-2 font-mono text-[11px] text-slate-500">
            container shell {connected ? '●' : '○ connecting'}
          </span>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 transition hover:text-slate-300">
          close
        </button>
      </div>
      <div ref={ref} className="h-72 p-2" />
    </div>
  );
}
