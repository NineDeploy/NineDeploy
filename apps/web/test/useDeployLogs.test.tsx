import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './web-utils.js';

const apiMock = vi.hoisted(() => ({
  deployLogsWsUrl: vi.fn(() => 'ws://localhost/v1/services/1/deploys/2/logs?token=t'),
}));

vi.mock('../src/lib/api.js', () => apiMock);

import { useDeployLogs } from '../src/lib/useDeployLogs.js';

describe('useDeployLogs', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    apiMock.deployLogsWsUrl.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates no socket and stays closed when ids are null', () => {
    const { result } = renderHook(() => useDeployLogs(null, null));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.lines).toBe('');
    expect(result.current.open).toBe(false);
  });

  it('opens a socket with the log URL and marks it open on connect', () => {
    const { result } = renderHook(() => useDeployLogs(1, 2));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(apiMock.deployLogsWsUrl).toHaveBeenCalledWith(1, 2);
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('ws://localhost/v1/services/1/deploys/2/logs?token=t');
    expect(result.current.open).toBe(false);

    act(() => ws?.open());
    expect(result.current.open).toBe(true);
  });

  it('appends incoming messages to the log lines', () => {
    const { result } = renderHook(() => useDeployLogs(1, 2));
    const ws = FakeWebSocket.instances[0];
    act(() => ws?.message('line one\n'));
    act(() => ws?.message('line two'));
    expect(result.current.lines).toBe('line one\nline two');
  });

  it('ignores messages from a stale socket after the deployment changes', () => {
    const { result, rerender } = renderHook(({ sid, did }) => useDeployLogs(sid, did), {
      initialProps: { sid: 1, did: 2 },
    });
    const first = FakeWebSocket.instances[0];
    act(() => first?.message('old'));

    rerender({ sid: 1, did: 3 });
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];
    expect(result.current.lines).toBe('');

    // Stale socket still fires, but its deployment id no longer matches.
    act(() => first?.message('stale'));
    expect(result.current.lines).toBe('');
    act(() => second?.message('fresh'));
    expect(result.current.lines).toBe('fresh');
  });

  it('marks the stream closed on error and on close', () => {
    const { result } = renderHook(() => useDeployLogs(1, 2));
    const ws = FakeWebSocket.instances[0];

    act(() => ws?.open());
    expect(result.current.open).toBe(true);

    act(() => ws?.error());
    expect(result.current.open).toBe(false);

    act(() => ws?.open());
    act(() => ws?.closeFromServer());
    expect(result.current.open).toBe(false);
  });

  it('closes the socket and resets on unmount', () => {
    const { unmount } = renderHook(() => useDeployLogs(1, 2));
    const ws = FakeWebSocket.instances[0];
    unmount();
    expect(ws?.close).toHaveBeenCalled();
  });
});
