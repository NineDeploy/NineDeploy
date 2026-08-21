import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './web-utils.js';

const apiMock = vi.hoisted(() => ({
  getToken: vi.fn((): string | null => 'tok-1'),
  execWsUrl: vi.fn((id: number) => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/v1/services/${id}/exec`),
  websocketAuthProtocols: vi.fn(() => ['ninedeploy.bearer.tok-1']),
}));

vi.mock('../src/lib/api.js', () => apiMock);

const xtermMock = vi.hoisted(() => {
  const terminals: unknown[] = [];
  const fitAddons: unknown[] = [];
  class FakeTerminal {
    opts: unknown;
    loadAddon = vi.fn();
    open = vi.fn();
    writeln = vi.fn();
    clear = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    onDataCb: ((data: string) => void) | null = null;
    constructor(opts: unknown) {
      this.opts = opts;
      terminals.push(this);
    }
    onData(cb: (data: string) => void) {
      this.onDataCb = cb;
    }
  }
  class FakeFitAddon {
    fit = vi.fn();
    constructor() {
      fitAddons.push(this);
    }
  }
  return { FakeTerminal, FakeFitAddon, terminals, fitAddons };
});

vi.mock('@xterm/xterm', () => ({ Terminal: xtermMock.FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xtermMock.FakeFitAddon }));

const reactMock = vi.hoisted(() => ({
  effects: [] as Array<() => () => void>,
  ref: { current: null as HTMLElement | null },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: () => reactMock.ref,
    useEffect: (cb: () => () => void) => {
      reactMock.effects.push(cb);
    },
  };
});

import { ContainerTerminal } from '../src/components/ContainerTerminal.js';

function runEffect(): () => void {
  const setup = reactMock.effects.shift();
  let cleanup: () => void = () => {};
  act(() => {
    const returned = setup ? setup() : undefined;
    cleanup = returned ?? (() => {});
  });
  return cleanup;
}

describe('ContainerTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reactMock.effects.length = 0;
    reactMock.ref.current = null;
    xtermMock.terminals.length = 0;
    xtermMock.fitAddons.length = 0;
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('early-returns when the ref is not attached', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    expect(reactMock.effects).toHaveLength(1);
    reactMock.ref.current = null;
    const cleanup = runEffect();
    expect(xtermMock.terminals).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(0);
    cleanup();
  });

  it('boots a terminal, opens the socket and marks connected', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    expect(reactMock.ref.current).toBeInstanceOf(HTMLElement);
    const cleanup = runEffect();

    expect(xtermMock.terminals).toHaveLength(1);
    const term = xtermMock.terminals[0] as {
      opts: unknown;
      loadAddon: ReturnType<typeof vi.fn>;
      open: ReturnType<typeof vi.fn>;
      writeln: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      onDataCb: ((d: string) => void) | null;
    };
    expect(term.opts).toEqual({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: { background: '#0a0a10', foreground: '#cbd5e1', cursor: '#6366f1' },
    });
    expect(xtermMock.fitAddons).toHaveLength(1);
    const fit = xtermMock.fitAddons[0] as { fit: ReturnType<typeof vi.fn> };
    expect(term.loadAddon).toHaveBeenCalledWith(fit);
    expect(term.open).toHaveBeenCalledWith(reactMock.ref.current);
    expect(fit.fit).toHaveBeenCalled();
    expect(term.writeln).toHaveBeenCalledWith('Connecting to container shell…');

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('ws://localhost/v1/services/1/exec');
    expect(ws?.protocols).toEqual(['ninedeploy.bearer.tok-1']);
    expect(ws?.binaryType).toBe('arraybuffer');

    act(() => ws?.open());
    expect(term.clear).toHaveBeenCalled();
    expect(screen.getByText(/●/)).toBeInTheDocument();
    cleanup();
  });

  it('builds a wss URL on an https origin', () => {
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'panel.example.com' },
      addEventListener: realAdd,
      removeEventListener: realRemove,
    } as unknown as Window);
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    runEffect();
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('wss://panel.example.com/v1/services/1/exec');
  });

  it('uses an empty token when none is stored', () => {
    apiMock.getToken.mockReturnValue(null);
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    runEffect();
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('ws://localhost/v1/services/1/exec');
  });

  it('writes binary and string messages to the terminal', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    const cleanup = runEffect();
    const term = xtermMock.terminals[0] as { write: ReturnType<typeof vi.fn> };
    const ws = FakeWebSocket.instances[0];
    act(() => ws?.message(new ArrayBuffer(8)));
    expect(term.write).toHaveBeenCalledWith(new Uint8Array(new ArrayBuffer(8)));
    act(() => ws?.message('hello'));
    expect(term.write).toHaveBeenCalledWith('hello');
    cleanup();
  });

  it('sends typed data over the socket while open, but not when closed', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    const cleanup = runEffect();
    const term = xtermMock.terminals[0] as { onDataCb: ((d: string) => void) | null };
    const ws = FakeWebSocket.instances[0];
    act(() => ws?.open());
    act(() => term.onDataCb?.('abc'));
    expect(ws?.send).toHaveBeenCalledWith('abc');
    act(() => ws?.closeFromServer());
    act(() => term.onDataCb?.('def'));
    expect(ws?.send).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('marks disconnected on close and writes a status line', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    const cleanup = runEffect();
    const term = xtermMock.terminals[0] as { write: ReturnType<typeof vi.fn> };
    const ws = FakeWebSocket.instances[0];
    act(() => ws?.open());
    expect(screen.getByText(/●/)).toBeInTheDocument();
    act(() => ws?.closeFromServer());
    expect(term.write).toHaveBeenCalledWith('\r\n\x1b[31m*** Connection closed ***\x1b[0m\r\n');
    expect(screen.getByText(/○ connecting/)).toBeInTheDocument();
    cleanup();
  });

  it('refits on window resize and cleans up on unmount', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    const cleanup = runEffect();
    const fit = xtermMock.fitAddons[0] as { fit: ReturnType<typeof vi.fn> };
    const term = xtermMock.terminals[0] as { dispose: ReturnType<typeof vi.fn> };
    const ws = FakeWebSocket.instances[0];

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(fit.fit).toHaveBeenCalledTimes(2);

    act(() => cleanup());
    expect(ws?.close).toHaveBeenCalled();
    expect(term.dispose).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(fit.fit).toHaveBeenCalledTimes(2);
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(<ContainerTerminal serviceId={1} onClose={onClose} />);
    runEffect();
    act(() => screen.getByText('close').click());
    expect(onClose).toHaveBeenCalled();
  });

  it('clears the existing terminal without reconnecting the shell', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    runEffect();
    const term = xtermMock.terminals[0] as { clear: ReturnType<typeof vi.fn> };
    term.clear.mockClear();
    const socketCount = FakeWebSocket.instances.length;
    act(() => screen.getByText('Clear').click());
    expect(term.clear).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances).toHaveLength(socketCount);
  });

  it('reconnects the shell session on demand', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    runEffect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => screen.getByText('Reconnect').click());
    // The mocked useEffect never re-runs on its own — invoke the new one.
    runEffect();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('expands to a fullscreen portal and Escape restores it', () => {
    render(<ContainerTerminal serviceId={1} onClose={vi.fn()} />);
    runEffect();

    act(() => screen.getByTitle('Expand full screen').click());
    expect(screen.getByTitle('Restore window size (Esc)')).toBeInTheDocument();

    // The Escape key listener (registered by the boot effect) restores size.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.getByTitle('Expand full screen')).toBeInTheDocument();
  });
});
