import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

const { buildEnv, capture, DEFAULT_HEARTBEAT_MS, DEFAULT_TIMEOUT_MS, ExecTimeoutError, run, sleep } = await import(
  '../../src/lib/exec.js'
);

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid?: number;
  kill?: (signal?: NodeJS.Signals) => boolean;
}

function makeChild(overrides: Partial<FakeChild> = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  Object.assign(child, overrides);
  return child;
}

function emitClose(child: FakeChild, code: number) {
  child.emit('close', code);
}

describe('buildEnv', () => {
  const snapshot: Record<string, string | undefined> = {};
  const keys = ['PATH', 'NINEDEPLOY_MASTER_KEY', 'NINEDEPLOY_JWT_SECRET', 'LC_MESSAGES'];

  beforeEach(() => {
    for (const k of keys) snapshot[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it('inherits only whitelisted host vars and merges the caller env', () => {
    process.env['PATH'] = '/usr/bin';
    process.env['NINEDEPLOY_MASTER_KEY'] = 'super-secret';
    process.env['NINEDEPLOY_JWT_SECRET'] = 'jwt-secret';

    const env = buildEnv({ FOO: 'bar' });

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['FOO']).toBe('bar');
    // Host secrets must NEVER leak into subprocesses.
    expect(env['NINEDEPLOY_MASTER_KEY']).toBeUndefined();
    expect(env['NINEDEPLOY_JWT_SECRET']).toBeUndefined();
  });

  it('omits unset whitelisted vars', () => {
    delete process.env['LC_MESSAGES'];
    expect(buildEnv()['LC_MESSAGES']).toBeUndefined();
  });

  it('works with no caller env', () => {
    expect(() => buildEnv()).not.toThrow();
  });
});

describe('run', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('streams stdout and stderr lines to the sink and resolves on exit 0', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const sink = vi.fn();
    const promise = run('echo', ['hi'], { cwd: '/tmp' }, sink);

    child.stdout.emit('data', Buffer.from('one\ntwo\n'));
    child.stderr.emit('data', Buffer.from('warn!\n'));
    emitClose(child, 0);

    await expect(promise).resolves.toBeUndefined();

    // stdin input path: pipe mode + EPIPE guard + end(input)
    const stdinChild = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mockSpawn.mockReturnValue(stdinChild as never);
    const p2 = run('base64', ['-d'], {}, vi.fn(), Buffer.from('payload'));
    stdinChild.stdin.emit('error', new Error('EPIPE')); // must not crash
    stdinChild.emit('close', 0);
    await expect(p2).resolves.toBeUndefined();
    expect(stdinChild.stdin.end).toHaveBeenCalledWith(Buffer.from('payload'));
    const lastCall = mockSpawn.mock.calls.at(-1) as unknown as [unknown, unknown, { stdio: string[] }];
    const stdio = lastCall[2].stdio;
    expect(stdio[0]).toBe('pipe');

    expect(mockSpawn).toHaveBeenCalledWith(
      'echo',
      ['hi'],
      expect.objectContaining({
        cwd: '/tmp',
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    expect(sink).toHaveBeenCalledWith('one');
    expect(sink).toHaveBeenCalledWith('two');
    expect(sink).toHaveBeenCalledWith('warn!');
  });

  it('buffers partial lines across chunks and flushes the tail on close', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const sink = vi.fn();
    const promise = run('cmd', [], {}, sink);

    // "a\n\nb" â†’ 'a' emitted now, 'b' is a partial line buffered until close.
    child.stdout.emit('data', Buffer.from('a\n\nb'));
    emitClose(child, 0);

    await promise;
    expect(sink).toHaveBeenCalledWith('a');
    expect(sink).toHaveBeenCalledWith('b');
    expect(sink).not.toHaveBeenCalledWith('');
  });

  it('passes a whitelisted env (not the full process.env) to spawn', async () => {
    process.env['NINEDEPLOY_MASTER_KEY'] = 'leak';
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = run('cmd', [], { env: { FOO: 'bar' } }, vi.fn());
    emitClose(child, 0);
    await promise;
    const env = mockSpawn.mock.calls[0]![2]!.env as Record<string, string>;
    expect(env['FOO']).toBe('bar');
    expect(env['NINEDEPLOY_MASTER_KEY']).toBeUndefined();
  });

  it('rejects when the process exits non-zero', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = run('false', [], {}, vi.fn());
    emitClose(child, 1);
    await expect(promise).rejects.toThrow('`false` exited with code 1');
  });

  it('rejects when the process emits an error', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const boom = new Error('ENOENT');
    const promise = run('missing', [], {}, vi.fn());
    child.emit('error', boom);
    await expect(promise).rejects.toBe(boom);
  });

  it('reports silent work with a safe label and stops heartbeats after exit', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const sink = vi.fn();
    const promise = run(
      'docker',
      ['login', '--password', 'must-not-leak'],
      { heartbeatMs: 1000, heartbeatLabel: 'Pulling application image' },
      sink,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(sink).toHaveBeenCalledWith('Still working: Pulling application image (1s elapsed) â€¦');
    expect(sink.mock.calls.flat().join(' ')).not.toContain('must-not-leak');

    child.stdout.emit('data', Buffer.from('activity without a newline'));
    sink.mockClear();
    await vi.advanceTimersByTimeAsync(999);
    expect(sink).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sink).toHaveBeenCalledWith('Still working: Pulling application image (2s elapsed) â€¦');

    emitClose(child, 0);
    await promise;
    sink.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sink).not.toHaveBeenCalled();
  });

  it('allows heartbeats to be disabled', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const sink = vi.fn();
    const promise = run('quiet', [], { heartbeatMs: 0 }, sink);
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_MS * 2);
    expect(sink).not.toHaveBeenCalled();
    emitClose(child, 0);
    await promise;
  });
});

describe('run â€” timeout & tree-kill', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('signals the whole process group, then escalates to SIGKILL', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = makeChild({ pid: 4242 });
    mockSpawn.mockReturnValue(child);

    const promise = run('stuck', [], { timeoutMs: 500 }, vi.fn());
    promise.catch(() => {}); // attach handler before the timer fires the rejection
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM');

    // SIGKILL escalation fires 5s after the SIGTERM.
    await vi.advanceTimersByTimeAsync(5000);
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('falls back to child.kill when the group signal fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    const kill = vi.fn();
    const child = makeChild({ pid: 4242, kill });
    mockSpawn.mockReturnValue(child);

    const promise = run('stuck', [], { timeoutMs: 500 }, vi.fn());
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('absorbs child.kill errors when the process is already dead', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    const kill = vi.fn(() => {
      throw new Error('ESRCH');
    });
    const child = makeChild({ pid: 4242, kill });
    mockSpawn.mockReturnValue(child);

    const promise = run('stuck', [], { timeoutMs: 500 }, vi.fn());
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
  });

  it('skips signalling when the child has no pid', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = makeChild(); // no pid â†’ guard returns early
    mockSpawn.mockReturnValue(child);

    const promise = run('stuck', [], { timeoutMs: 500 }, vi.fn());
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('ignores close/error that arrive after the timeout already settled', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = makeChild({ pid: 4242 });
    mockSpawn.mockReturnValue(child);

    const promise = run('stuck', [], { timeoutMs: 1000 }, vi.fn());
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);

    // Late events must not cause an unhandled rejection / double-settle.
    expect(() => {
      emitClose(child, 0);
      child.emit('error', new Error('late'));
    }).not.toThrow();
  });
});

describe('capture', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('collects stdout and resolves on exit 0', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = capture('df', ['-k', '/']);

    child.stdout.emit('data', Buffer.from('Filesystem\n/dev/disk 123'));
    child.stderr.emit('data', Buffer.from('ignored'));
    emitClose(child, 0);

    await expect(promise).resolves.toBe('Filesystem\n/dev/disk 123');
  });

  it('includes stderr in the rejection message on non-zero exit', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = capture('docker', ['stats']);
    child.stderr.emit('data', Buffer.from('daemon not running'));
    emitClose(child, 2);
    await expect(promise).rejects.toThrow('`docker stats` exited 2: daemon not running');
  });

  it('rejects on spawn error', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const boom = new Error('spawn failed');
    const promise = capture('nope', []);
    child.emit('error', boom);
    await expect(promise).rejects.toBe(boom);
  });

  it('rejects on non-zero exit with no stderr (omits the stderr suffix)', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = capture('docker', ['stats']);
    // No stderr data emitted â†’ errOut is empty.
    emitClose(child, 2);
    await expect(promise).rejects.toThrow('`docker stats` exited 2');
  });

  it('rejects with ExecTimeoutError when the command exceeds its timeout', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = capture('slow', [], { timeoutMs: 250 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
  });

  it('ignores close after a timeout settled', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = capture('slow', [], { timeoutMs: 250 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(() => emitClose(child, 0)).not.toThrow();
  });

  it('ignores error after a timeout settled', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const promise = capture('slow', [], { timeoutMs: 250 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).rejects.toBeInstanceOf(ExecTimeoutError);
    expect(() => child.emit('error', new Error('late'))).not.toThrow();
  });
});

describe('ExecTimeoutError', () => {
  it('exposes the command and timeout', () => {
    const err = new ExecTimeoutError('docker build', 1000);
    expect(err.cmd).toBe('docker build');
    expect(err.message).toContain('1000ms');
    expect(err.name).toBe('ExecTimeoutError');
  });
});

describe('sleep', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves after the given number of milliseconds', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const promise = sleep(500).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(resolved).toBe(true);
  });
});

describe('DEFAULT_TIMEOUT_MS', () => {
  it('is 30 minutes', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe('DEFAULT_HEARTBEAT_MS', () => {
  it('is 20 seconds', () => {
    expect(DEFAULT_HEARTBEAT_MS).toBe(20 * 1000);
  });
});
