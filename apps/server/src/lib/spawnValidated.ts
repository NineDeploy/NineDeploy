import { spawn, type ChildProcess } from 'node:child_process';
import { makeLineSplitter } from './exec.js';

/**
 * Single choke-point for spawning the two agent executables. The argv arrays
 * passed here are produced exclusively by the typed operation table in
 * agent.ts (literal flags + regex-validated operands); this module exists so
 * there is exactly ONE spawn site to audit.
 */

export type AllowedExecutable = 'docker' | 'git';

/** Spawn one of the two fixed executables and collect its output lines. */
export function spawnValidated(
  executable: AllowedExecutable,
  argv: string[],
  onLine: (line: string) => void,
): Promise<number> {
  const child: ChildProcess =
    executable === 'docker' ? spawn('docker', argv, {}) : spawn('git', argv, {});
  return new Promise<number>((resolve) => {
    child.stdin?.on('error', () => { /* child gone */ });
    const outSplitter = makeLineSplitter();
    const errSplitter = makeLineSplitter();
    child.stdout?.on('data', (d: Buffer) => {
      for (const l of outSplitter.feed(d)) onLine(l);
    });
    child.stderr?.on('data', (d: Buffer) => {
      for (const l of errSplitter.feed(d)) onLine(l);
    });
    child.on('error', () => resolve(127));
    child.on('close', (code) => {
      for (const tail of [outSplitter.flush(), errSplitter.flush()]) {
        if (tail) onLine(tail);
      }
      resolve(code ?? 0);
    });
  });
}
