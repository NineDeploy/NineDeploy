import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyReady, startWatchdog } from '../../src/lib/sdNotify.js';

describe('sdNotify', () => {
  // Without NOTIFY_SOCKET every function must be a silent no-op (dev/Docker/tests).
  it('notifyReady is a no-op without NOTIFY_SOCKET', () => {
    delete process.env['NOTIFY_SOCKET'];
    expect(() => notifyReady()).not.toThrow();
  });

  it('watchdog pings can be started and stopped', () => {
    delete process.env['NOTIFY_SOCKET'];
    const stop = startWatchdog(10);
    stop();
  });

  it('sends READY=1 to the NOTIFY_SOCKET unix socket', { timeout: 5000 }, async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nd-notify-'));
    const sockPath = path.join(dir, 'notify.sock');
    const received: string[] = [];
    const server: Server = createServer((conn) => {
      conn.on('data', (buf) => received.push(buf.toString()));
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));
    try {
      process.env['NOTIFY_SOCKET'] = sockPath;
      vi.resetModules(); // the socket path is resolved at module load
      const { notifyReady: ready } = await import('../../src/lib/sdNotify.js');
      ready();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(received.join('')).toContain('READY=1');
    } finally {
      delete process.env['NOTIFY_SOCKET'];
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('swallows socket errors from a dead NOTIFY_SOCKET', { timeout: 5000 }, async () => {
    process.env['NOTIFY_SOCKET'] = '/nonexistent/ninedeploy-notify.sock';
    try {
      vi.resetModules();
      const { notifyReady: ready, startWatchdog: watchdog } = await import('../../src/lib/sdNotify.js');
      expect(() => ready()).not.toThrow();
      const stop = watchdog(5);
      await new Promise((resolve) => setTimeout(resolve, 20));
      stop();
    } finally {
      delete process.env['NOTIFY_SOCKET'];
    }
  });

  it('translates @-prefixed abstract sockets', { timeout: 5000 }, async () => {
    process.env['NOTIFY_SOCKET'] = '@/ninedeploy-notify';
    try {
      vi.resetModules();
      const { notifyReady: ready } = await import('../../src/lib/sdNotify.js');
      // The abstract namespace socket doesn't exist — errors are swallowed.
      expect(() => ready()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      delete process.env['NOTIFY_SOCKET'];
    }
  });

  afterEach(() => {
    delete process.env['NOTIFY_SOCKET'];
  });
});
