import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Per-deployment log bus: appends every line to disk and emits it to live
 * subscribers (the WebSocket log stream).
 */
class LogBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  publish(deploymentId: number, line: string): void {
    const file = path.join(config.paths.logsDir, `${deploymentId}.log`);
    try {
      appendFileSync(file, `${line}\n`);
    } catch {
      /* best effort */
    }
    this.emit(String(deploymentId), line);
  }

  read(deploymentId: number): string {
    const file = path.join(config.paths.logsDir, `${deploymentId}.log`);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  subscribe(deploymentId: number, onLine: (line: string) => void): () => void {
    const key = String(deploymentId);
    this.on(key, onLine);
    return () => this.off(key, onLine);
  }
}

export const logBus = new LogBus();

/**
 * Remove deploy-log files older than `maxAgeMs` (judged by mtime). Deploy logs
 * accumulate one file per deployment and are never otherwise cleaned up, so
 * without this the logs directory grows without bound. Returns the count removed.
 */
export function pruneOldLogs(maxAgeMs: number): number {
  const dir = config.paths.logsDir;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0; // directory missing — nothing to prune
  }
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const file = path.join(dir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) {
        rmSync(file, { force: true });
        removed++;
      }
    } catch {
      /* best effort — file may have vanished between readdir and stat */
    }
  }
  return removed;
}

