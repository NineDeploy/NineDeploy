import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spawnValidated } from '../../src/lib/spawnValidated.js';

const childMocks = vi.hoisted(() => {
  const make = () => {
    const handlers: Record<string, Array<(arg: unknown) => void>> = {};
    return {
      handlers,
      child: {
        stdin: { on: vi.fn((ev: string, cb: (arg: unknown) => void) => { const list = (handlers[`stdin:${ev}`] ?? []); list.push(cb); handlers[`stdin:${ev}`] = list; }) },
        stdout: {
          on: vi.fn((ev: string, cb: (arg: unknown) => void) => { const list = (handlers[`stdout:${ev}`] ?? []); list.push(cb); handlers[`stdout:${ev}`] = list; }),
        },
        stderr: {
          on: vi.fn((ev: string, cb: (arg: unknown) => void) => { const list = (handlers[`stderr:${ev}`] ?? []); list.push(cb); handlers[`stderr:${ev}`] = list; }),
        },
        on: vi.fn((ev: string, cb: (arg: unknown) => void) => { const list = (handlers[ev] ?? []); list.push(cb); handlers[ev] = list; }),
      },
      emit: (ev: string, arg: unknown) => { for (const cb of handlers[ev] ?? []) cb(arg); },
    };
  };
  const api = {
    make,
    spawn: vi.fn(() => { const m = make(); (api as { current: unknown }).current = m; return m.child; }),
    current: null as null | ReturnType<typeof make>,
  };
  return api;
});
vi.mock('node:child_process', () => ({ spawn: childMocks.spawn }));

describe('spawnValidated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects stdout/stderr lines and resolves with the exit code', async () => {
    const lines: string[] = [];
    const _mock = childMocks.current!;
    const promise = spawnValidated('docker', ['ps'], (l) => lines.push(l));
    const cur = childMocks.current!;
    cur.emit('stdout:data', Buffer.from('line1\nline2\n'));
    cur.emit('stderr:data', Buffer.from('err-out\n'));
    cur.emit('exit', 0);
    await expect(promise).resolves.toBe(0);
    expect(lines).toEqual(['line1', 'line2', 'err-out']);
    expect(childMocks.spawn).toHaveBeenCalledWith('docker', ['ps'], {});
  });

  it('spawns git for the git executable', async () => {
    const promise = spawnValidated('git', ['fetch', '--all'], () => {});
    childMocks.current!.emit('exit', 1);
    await expect(promise).resolves.toBe(1);
    expect(childMocks.spawn).toHaveBeenCalledWith('git', ['fetch', '--all'], {});
  });

  it('resolves 127 on a spawn error', async () => {
    const promise = spawnValidated('docker', ['ps'], () => {});
    childMocks.current!.emit('error', new Error('ENOENT'));
    await expect(promise).resolves.toBe(127);
  });

  it('treats a null exit code as 0', async () => {
    const promise = spawnValidated('docker', ['ps'], () => {});
    childMocks.current!.emit('exit', null);
    await expect(promise).resolves.toBe(0);
  });

  it('swallows stdin EPIPE races', async () => {
    const promise = spawnValidated('git', ['clone', 'x'], () => {});
    childMocks.current!.emit('stdin:error', new Error('EPIPE'));
    childMocks.current!.emit('exit', 0);
    await expect(promise).resolves.toBe(0);
  });
});
