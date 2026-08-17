import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import dbPlugin from '../../src/plugins/db.js';
import kernelPlugin from '../../src/plugins/kernel.js';
import { createFakeDb } from '../helpers.js';

describe('Fastify Kernel Plugin', () => {
  it('decorates fastify with kernel, registers core drivers, boots on ready, and shuts down on close', async () => {
    const app = Fastify({ logger: false });
    const fakeDb = createFakeDb();
    app.decorate('db', fakeDb as any);

    await app.register(kernelPlugin);

    expect(app.kernel).toBeDefined();
    expect(app.kernel.registry.getCompute('docker-local')).toBeDefined();
    expect(app.kernel.registry.getProxy('traefik')).toBeDefined();
    expect(app.kernel.getPlugin('notifications-dispatcher')).toBeDefined();
    expect(app.kernel.getPlugin('cloudflare-tunnels')).toBeDefined();
    expect(app.kernel.getPlugin('telemetry-streamer')).toBeDefined();

    // Fastify route checking req.kernel
    app.get('/test-kernel', async (req) => {
      return { state: req.kernel.state, hasCompute: !!req.kernel.registry.getCompute('docker-local') };
    });

    await app.ready();
    expect(app.kernel.state).toBe('READY');

    const res = await app.inject({ method: 'GET', url: '/test-kernel' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'READY', hasCompute: true });

    await app.close();
    expect(app.kernel.state).toBe('TERMINATED');
  });

  it('handles boot and shutdown error catches in hooks', async () => {
    const app = Fastify({ logger: false });
    const fakeDb = createFakeDb();
    app.decorate('db', fakeDb as any);

    await app.register(kernelPlugin);

    // Mock boot failure
    const bootSpy = vi.spyOn(app.kernel, 'boot').mockRejectedValueOnce(new Error('Boot boom'));
    const shutdownSpy = vi.spyOn(app.kernel, 'shutdown').mockRejectedValueOnce(new Error('Shutdown boom'));

    await expect(app.ready()).resolves.toBeDefined();
    await expect(app.close()).resolves.toBeUndefined();

    bootSpy.mockRestore();
    shutdownSpy.mockRestore();
  });

  it('skips setup if kernel is already decorated', async () => {
    const app = Fastify({ logger: false });
    const existingKernel = { state: 'READY' };
    app.decorate('kernel', existingKernel as any);

    await app.register(kernelPlugin);
    expect(app.kernel).toBe(existingKernel);
  });
});
