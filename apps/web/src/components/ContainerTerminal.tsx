import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Maximize2, Minimize2, RefreshCw, Terminal as TerminalIcon, Trash2, X } from 'lucide-react';
import { execWsUrl } from '../lib/api.js';
import { Button, cn } from './ui.js';

interface ContainerTerminalProps {
  serviceId: number;
  serviceName?: string;
  onClose?: () => void;
}

export function ContainerTerminal({ serviceId, serviceName, onClose }: ContainerTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionKey is intentionally used to re-trigger the effect for reconnect
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: { background: '#0a0a10', foreground: '#cbd5e1', cursor: '#6366f1' },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    term.writeln('Connecting to container shell…');

    const ws = new WebSocket(execWsUrl(serviceId));
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnected(true);
      term.clear();
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data as string);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.write('\r\n\x1b[31m*** Connection closed ***\x1b[0m\r\n');
    };

    ws.onerror = () => {
      setConnected(false);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const onResize = () => {
      fit.fit();
    };
    window.addEventListener('resize', onResize);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      ws.close();
      term.dispose();
    };
  }, [serviceId, sessionKey]);

  const handleReconnect = () => {
    setSessionKey((k) => k + 1);
  };

  const toggleFullscreen = () => {
    setFullscreen((v) => !v);
  };

  const content = (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-white/15 bg-[#0a101b] shadow-2xl transition-all duration-200 flex flex-col',
        fullscreen ? 'h-[92vh] w-[95vw] max-w-7xl' : 'h-[520px] max-h-[70vh] w-full',
      )}
    >
      {/* Terminal Titlebar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0f172a]/95 px-4 py-2.5 select-none backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-rose-500/80 ring-1 ring-inset ring-rose-500/30" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80 ring-1 ring-inset ring-amber-500/30" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80 ring-1 ring-inset ring-emerald-500/30" />
          </div>

          <div className="flex items-center gap-2">
            <TerminalIcon size={14} className="text-slate-400" />
            <span className="font-mono text-xs font-semibold text-slate-200">
              {serviceName ? `${serviceName} · sh` : 'container shell'}
            </span>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium font-mono">
            {connected ? (
              <span className="text-emerald-300">● connected</span>
            ) : (
              <span className="text-slate-400">○ connecting</span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleReconnect}
            title="Reconnect shell session"
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
          >
            <RefreshCw size={12} className={cn(!connected && 'animate-spin')} />
            <span className="hidden sm:inline">Reconnect</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleReconnect}
            title="Clear terminal output"
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">Clear</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Restore window size (Esc)' : 'Expand full screen'}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
          >
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </Button>

          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              title="Close terminal"
              className="h-7 px-2 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 ml-1"
            >
              <X size={13} />
              <span>close</span>
            </Button>
          )}
        </div>
      </div>

      {/* XTerm Screen Container */}
      <div
        ref={containerRef}
        className="terminal-container relative flex-1 min-h-0 w-full overflow-hidden focus:outline-none"
      />
    </div>
  );

  if (fullscreen && typeof document !== 'undefined') {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
        {content}
      </div>,
      document.body,
    );
  }

  return content;
}
