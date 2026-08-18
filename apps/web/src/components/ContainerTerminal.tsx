import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Maximize2, Minimize2, RefreshCw, Terminal as TerminalIcon, Trash2, X } from 'lucide-react';
import { getToken } from '../lib/api.js';
import { Button, cn } from './ui.js';

interface ContainerTerminalProps {
  serviceId: number;
  serviceName?: string;
  onClose?: () => void;
}

export function ContainerTerminal({ serviceId, serviceName, onClose }: ContainerTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [fullscreen, setFullscreen] = useState(false);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up any existing connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    if (!termRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 13,
        lineHeight: 1.2,
        convertEol: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace",
        theme: {
          background: '#0a101b',
          foreground: '#e2e8f0',
          cursor: '#4ecdc4',
          selectionBackground: 'rgba(78, 205, 196, 0.3)',
          black: '#0a101b',
          red: '#f43f5e',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#8b5cf6',
          cyan: '#4ecdc4',
          white: '#f8fafc',
          brightBlack: '#475569',
          brightRed: '#fb7185',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#a78bfa',
          brightCyan: '#7ce4dc',
          brightWhite: '#ffffff',
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = fit;
      term.focus();
      setTimeout(() => {
        fit.fit();
        term.focus();
      }, 50);

      let currentLine = '';
      const history: string[] = [];
      let historyIndex = -1;

      term.onData((data) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        // Enter key
        if (data === '\r' || data === '\n') {
          term.write('\r\n');
          wsRef.current.send(`${currentLine}\n`);
          if (currentLine.trim()) {
            history.push(currentLine);
            historyIndex = history.length;
          }
          currentLine = '';
          return;
        }

        // Backspace
        if (data === '\x7f' || data === '\b') {
          if (currentLine.length > 0) {
            currentLine = currentLine.slice(0, -1);
            term.write('\b \b');
          }
          return;
        }

        // Ctrl+C
        if (data === '\x03') {
          term.write('^C\r\n');
          wsRef.current.send('\x03');
          currentLine = '';
          return;
        }

        // Ctrl+L (Clear screen)
        if (data === '\x0c') {
          term.clear();
          return;
        }

        // Arrow Up (History Prev)
        if (data === '\x1b[A') {
          if (history.length > 0 && historyIndex > 0) {
            historyIndex--;
            while (currentLine.length > 0) {
              term.write('\b \b');
              currentLine = currentLine.slice(0, -1);
            }
            currentLine = history[historyIndex] ?? '';
            term.write(currentLine);
          }
          return;
        }

        // Arrow Down (History Next)
        if (data === '\x1b[B') {
          if (historyIndex < history.length - 1) {
            historyIndex++;
            while (currentLine.length > 0) {
              term.write('\b \b');
              currentLine = currentLine.slice(0, -1);
            }
            currentLine = history[historyIndex] ?? '';
            term.write(currentLine);
          } else if (historyIndex === history.length - 1) {
            historyIndex = history.length;
            while (currentLine.length > 0) {
              term.write('\b \b');
              currentLine = currentLine.slice(0, -1);
            }
          }
          return;
        }

        // Printable characters
        if (data >= ' ' || data.length > 1) {
          currentLine += data;
          term.write(data);
        }
      });
    }

    const term = termRef.current;
    const fit = fitRef.current;

    setStatus('connecting');
    term.writeln('\r\n\x1b[36m⚡ Connecting to container shell...\x1b[0m');

    const token = getToken() ?? '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${proto}://${window.location.host}/v1/services/${serviceId}/exec?token=${token}`,
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      term.clear();
      term.writeln('\x1b[32m✔ Connected to interactive container shell.\x1b[0m');
      term.writeln('\x1b[90mType "exit" or click Close to terminate the session.\x1b[0m\r\n');
      if (fit) fit.fit();
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data as string);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      term.writeln('\r\n\x1b[31m✕ Connection closed.\x1b[0m');
      term.writeln('\x1b[90mClick "Reconnect" above to start a new shell session.\x1b[0m');
    };

    ws.onerror = () => {
      setStatus('disconnected');
      term.writeln('\r\n\x1b[31m⚠ WebSocket connection error.\x1b[0m');
    };
  }, [serviceId]);

  useEffect(() => {
    connect();

    const containerEl = containerRef.current;
    let observer: ResizeObserver | null = null;
    if (containerEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (fitRef.current) fitRef.current.fit();
      });
      observer.observe(containerEl);
    }

    const onResize = () => {
      if (fitRef.current) fitRef.current.fit();
    };
    window.addEventListener('resize', onResize);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  }, [connect]);

  // Refit when fullscreen changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitRef.current) fitRef.current.fit();
      if (termRef.current) {
        termRef.current.scrollToBottom();
        termRef.current.focus();
      }
    }, fullscreen ? 100 : 50);
    return () => clearTimeout(timer);
  }, [fullscreen]);

  // Escape to exit fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
      termRef.current.focus();
    }
  };

  const content = (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-white/15 bg-[#0a101b] shadow-2xl transition-all duration-200 flex flex-col',
        fullscreen ? 'h-[92vh] w-[95vw] max-w-7xl' : 'w-full',
      )}
    >
      {/* Terminal Titlebar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0f172a]/95 px-4 py-2.5 select-none backdrop-blur-md">
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
          <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                status === 'connected' && 'bg-emerald-400 animate-pulse',
                status === 'connecting' && 'bg-amber-400 animate-ping',
                status === 'disconnected' && 'bg-rose-400',
              )}
            />
            <span
              className={cn(
                'capitalize font-mono text-[10px]',
                status === 'connected' && 'text-emerald-300',
                status === 'connecting' && 'text-amber-300',
                status === 'disconnected' && 'text-rose-300',
              )}
            >
              {status}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={connect}
            title="Reconnect shell session"
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
          >
            <RefreshCw size={12} className={cn(status === 'connecting' && 'animate-spin')} />
            <span className="hidden sm:inline">Reconnect</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleClear}
            title="Clear terminal output"
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">Clear</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'Restore window size (Esc)' : 'Expand full screen'}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
          >
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </Button>

          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (wsRef.current) {
                  try {
                    wsRef.current.close();
                  } catch {
                    // ignore
                  }
                }
                onClose();
              }}
              title="Close terminal"
              className="h-7 px-2 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 ml-1"
            >
              <X size={13} />
              <span className="hidden sm:inline">Close</span>
            </Button>
          )}
        </div>
      </div>

      {/* XTerm Screen Container */}
      <div
        ref={containerRef}
        className={cn(
          'p-3 focus:outline-none overflow-hidden flex-1',
          fullscreen ? 'min-h-[400px]' : 'min-h-[320px] h-80',
        )}
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
