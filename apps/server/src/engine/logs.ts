import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Per-deployment log bus: appends every line to disk and emits it to live
 * subscribers (the WebSocket log stream).
 */
class LogBus extends EventEmitter {
  publish(deploymentId: number, line: string): void {
    const file = path.join(config.paths.logsDir, `${deploymentId}.log`);
    try {
      appendFileSync(file, line + '\n');
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
