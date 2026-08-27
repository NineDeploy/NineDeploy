import { spawn, type ChildProcess } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Hard kill the process (and its children) after this many ms. Default: 30 min. */
  timeoutMs?: number;
  /** Emit a progress heartbeat after this much output silence. Set to 0 to disable. */
  heartbeatMs?: number;
  /** Safe, user-facing heartbeat label. Command arguments are never logged implicitly. */
  heartbeatLabel?: string;
}

/**
 * Environment variables that are safe to inherit from the host into a build or
 * runtime subprocess. Everything else (host secrets like the master key, JWT
 * secret, etc.) is deliberately excluded so it can never leak into a user-
 * controlled build shell or `docker inspect`.
 */
const SAFE_INHERITED_ENV = new Set([
  // OS / shell basics needed to locate and run binaries.
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TMPDIR',
  // Windows equivalents: the Docker CLI locates its bundled compose plugin
  // under %ProgramFiles%\Docker\Docker\resources\cli-plugins (plus
  // %USERPROFILE%\.docker\cli-plugins), and children need SystemRoot.
  'USERPROFILE', 'APPDATA', 'ProgramFiles', 'ProgramData', 'SystemRoot',
  // Locale — some tools refuse to start without it.
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES',
  // Build mode is safe and often expected by toolchains.
  'NODE_ENV',
  // Docker daemon connection — required to talk to the docker socket/daemon.
  'DOCKER_HOST', 'DOCKER_BUILDKIT', 'DOCKER_CONTEXT', 'COMPOSE_FILE',
]);

/** Build an isolated environment: only safe host vars + the caller-supplied env. */
export function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_INHERITED_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (extra) for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

/** Rejects when a subprocess exceeds its timeout. */
export class ExecTimeoutError extends Error {
  constructor(public readonly cmd: string, timeoutMs: number) {
    super(`\`${cmd}\` timed out after ${timeoutMs}ms`);
    this.name = 'ExecTimeoutError';
  }
}

/** Default per-command timeout: 30 minutes (builds can be slow). */
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** A silent command should never make a deployment look frozen for longer than this. */
export const DEFAULT_HEARTBEAT_MS = 20 * 1000;

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

/** Report liveness only while a command is silent, keeping normal logs uncluttered. */
function armHeartbeat(
  sink: (line: string) => void,
  intervalMs: number,
  label: string,
  startedAt: number,
  getLastActivityAt: () => number,
): () => void {
  if (intervalMs <= 0) return () => {};
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - getLastActivityAt() < intervalMs) return;
    sink(`Still working: ${label} (${formatElapsed(now - startedAt)} elapsed) …`);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Send a signal to a process and all of its children. `spawn({ detached: true })`
 * makes the child a process-group leader, so `process.kill(-pid)` reaches the
 * whole tree (e.g. `sh -c` → `docker build`). Falls back to a plain kill if the
 * group signal fails (already dead, or unsupported platform).
 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== 'number') return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
  }
}

/** Split a buffer stream into complete lines, buffering any trailing partial line. */
function makeLineSplitter() {
  let pending = '';
  return {
    feed(chunk: Buffer): string[] {
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      // split() always yields a non-empty array, so pop() is always a string.
      pending = parts.pop() as string;
      return parts.filter((line) => line.length > 0);
    },
    flush(): string {
      const rest = pending;
      pending = '';
      return rest;
    },
  };
}

/**
 * Arm a hard timeout for a detached child. After `timeoutMs` it tree-kills with
 * SIGTERM, escalates to SIGKILL 5s later, and invokes `onTimeout` exactly once.
 * Returns a cancel function to clear both timers once the child settles.
 */
function armTimeout(child: ChildProcess, timeoutMs: number, onTimeout: () => void): () => void {
  // fire runs at most once: setTimeout fires once and cancel() clears it.
  const fire = () => {
    killTree(child, 'SIGTERM');
    onTimeout();
    // Escalate so a stuck process can never block shutdown forever.
    const killTimer = setTimeout(() => killTree(child, 'SIGKILL'), 5000);
    killTimer.unref();
  };
  const timer = setTimeout(fire, timeoutMs);
  timer.unref();
  return () => clearTimeout(timer);
}

/**
 * Run a command, streaming each stdout/stderr line to `sink`.
 * Rejects with an Error (or {@link ExecTimeoutError}) if the process exits
 * non-zero or exceeds its timeout.
 */
export function run(cmd: string, args: string[], opts: ExecOptions, sink: (line: string) => void, input?: Buffer): Promise<void> {
  const label = [cmd, ...args].join(' ');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: buildEnv(opts.env),
      detached: true,
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    if (input && child.stdin) {
      child.stdin.on('error', () => { /* EPIPE when the child exits early */ });
      child.stdin.end(input);
    }

    const splitter = makeLineSplitter();
    const onData = (chunk: Buffer) => {
      lastActivityAt = Date.now();
      for (const line of splitter.feed(chunk)) sink(line);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let settled = false;
    const cancelHeartbeat = armHeartbeat(
      sink,
      opts.heartbeatMs ?? 0,
      opts.heartbeatLabel ?? cmd,
      startedAt,
      () => lastActivityAt,
    );
    // onTimeout fires from the single-shot timer; close/error cancel it first,
    // and Promise settlement is idempotent regardless, so no settled guard here.
    const cancelTimeout = armTimeout(child, timeoutMs, () => {
      settled = true;
      cancelHeartbeat();
      reject(new ExecTimeoutError(label, timeoutMs));
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      cancelHeartbeat();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      cancelHeartbeat();
      const tail = splitter.flush();
      if (tail.length) sink(tail);
      if (code === 0) resolve();
      else reject(new Error(`\`${label}\` exited with code ${code}`));
    });
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run a command and return its captured stdout (rejects on non-zero exit). */
export function capture(cmd: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  const label = [cmd, ...args].join(' ');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: buildEnv(opts.env),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let errOut = '';
    let settled = false;
    // onTimeout fires from the single-shot timer; close/error cancel it first,
    // and Promise settlement is idempotent regardless, so no settled guard here.
    const cancelTimeout = armTimeout(child, timeoutMs, () => {
      settled = true;
      reject(new ExecTimeoutError(label, timeoutMs));
    });

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (errOut += d.toString()));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      if (code === 0) resolve(out);
      else reject(new Error(`\`${label}\` exited ${code}${errOut ? `: ${errOut.trim()}` : ''}`));
    });
  });
}
