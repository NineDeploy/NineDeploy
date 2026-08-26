import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logBus, pruneOldLogs } from '../src/engine/logs.js';

const h = vi.hoisted(() => {
  const config: { paths: { logsDir: string } } = { paths: { logsDir: '' } };
  return { config };
});

vi.mock('../src/config.js', () => ({ config: h.config }));

const base = mkdtempSync(path.join(os.tmpdir(), 'nd-logs-'));
const logsDir = path.join(base, 'logs');
mkdirSync(logsDir, { recursive: true });
h.config.paths = { logsDir };

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('logBus', () => {
  beforeEach(() => {
    logBus.removeAllListeners();
  });

  it('publishes a line to subscribers and persists it to disk', () => {
    const listener = vi.fn();
    const unsubscribe = logBus.subscribe(42, listener);

    logBus.publish(42, 'hello');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('hello');
    expect(logBus.read(42)).toBe('hello\n');
    unsubscribe();
  });

  it('unsubscribing stops delivery', () => {
    const listener = vi.fn();
    const unsubscribe = logBus.subscribe(43, listener);
    unsubscribe();

    logBus.publish(43, 'gone');

    expect(listener).not.toHaveBeenCalled();
  });

  it('read returns an empty string when no log file exists', () => {
    expect(logBus.read(999)).toBe('');
  });

  it('still emits to subscribers when appending to disk fails', () => {
    const blocker = path.join(base, 'blocker');
    writeFileSync(blocker, '');
    h.config.paths.logsDir = blocker;

    const listener = vi.fn();
    logBus.subscribe(7, listener);
    logBus.publish(7, 'line');

    expect(listener).toHaveBeenCalledWith('line');
  });
});

describe('pruneOldLogs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nd-prune-'));
    h.config.paths.logsDir = dir;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes only .log files older than the max age', () => {
    const oldFile = path.join(dir, '1.log');
    const newFile = path.join(dir, '2.log');
    const ignored = path.join(dir, 'readme.txt');
    writeFileSync(oldFile, 'old');
    writeFileSync(newFile, 'new');
    writeFileSync(ignored, 'keep me');

    // Age the old file back by 10 days; leave the new one current.
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, old, old);

    const removed = pruneOldLogs(7 * 24 * 60 * 60 * 1000); // 7-day cutoff

    expect(removed).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    expect(existsSync(ignored)).toBe(true); // non-.log files are never touched
  });

  it('returns 0 when the logs directory is missing', () => {
    h.config.paths.logsDir = path.join(dir, 'does-not-exist');
    expect(pruneOldLogs(60_000)).toBe(0);
  });
});
