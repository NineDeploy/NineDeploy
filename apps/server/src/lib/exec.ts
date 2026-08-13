import { spawn } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Run a command, streaming each stdout/stderr line to `sink`.
 * Rejects with an Error if the process exits non-zero.
 */
export function run(cmd: string, args: string[], opts: ExecOptions, sink: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onData = (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.length) sink(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${[cmd, ...args].join(' ')}\` exited with code ${code}`));
    });
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run a command and return its captured stdout (rejects on non-zero exit). */
export function capture(cmd: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`\`${cmd}\` exited ${code}`))));
  });
}
