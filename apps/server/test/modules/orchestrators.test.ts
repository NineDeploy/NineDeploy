import { describe, expect, it, vi } from 'vitest';
import { orchestratorsRoutes } from '../../src/modules/orchestrators.js';
import { asUser, buildTestApp } from '../helpers.js';

describe('orchestrators routes', () => {
  it('lists every registered orchestrator with its stack names', async () => {
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    // Replace the real registry with a fake that returns two drivers
    // and pre-canned `listStacks()` results. The route treats the
    // shape as opaque, so any promise-resolving array is enough.
    const local = { name: 'local', listStacks: vi.fn().mockResolvedValue(['web', 'api']) };
    const swarm = { name: 'swarm', listStacks: vi.fn().mockResolvedValue([]) };
    (app as unknown as { kernel: { registry: { listOrchestrators: () => unknown[]; getOrchestrator: (n: string) => unknown } } }).kernel.registry.listOrchestrators = () => [local, swarm];
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      orchestrators: [
        { name: 'local', stacks: ['web', 'api'] },
        { name: 'swarm', stacks: [] },
      ],
    });
    expect(local.listStacks).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('returns an empty array when no orchestrators are registered', async () => {
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    (app as unknown as { kernel: { registry: { listOrchestrators: () => unknown[] } } }).kernel.registry.listOrchestrators = () => [];
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.json()).toEqual({ orchestrators: [] });
    await app.close();
  });

  it('returns the per-stack status from the named orchestrator', async () => {
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    const driver = {
      getStackStatus: vi.fn().mockResolvedValue({
        name: 'web',
        services: [{ name: 'web', replicas: 3, ready: 3 }],
        appliedAt: '2026-01-01T00:00:00.000Z',
      }),
    };
    (app as unknown as { kernel: { registry: { getOrchestrator: (n: string) => unknown } } }).kernel.registry.getOrchestrator = (n: string) =>
      n === 'swarm' ? driver : undefined;
    const res = await app.inject({ method: 'GET', url: '/swarm/stacks', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'web',
      services: [{ name: 'web', replicas: 3, ready: 3 }],
      appliedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(driver.getStackStatus).toHaveBeenCalledWith('swarm');
    await app.close();
  });

  it('returns an error envelope when the named orchestrator is not registered', async () => {
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    (app as unknown as { kernel: { registry: { getOrchestrator: () => undefined } } }).kernel.registry.getOrchestrator = () => undefined;
    const res = await app.inject({ method: 'GET', url: '/unknown/stacks', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ error: 'Orchestrator "unknown" is not registered' });
    await app.close();
  });

  it('passes the orchestrator name as the stack name to getStackStatus', async () => {
    // `getStackStatus(name)` is the Swarm driver's "is this stack
    // deployed here?" probe — it takes the stack name as the
    // argument. The route must pass `req.params.name` through
    // unchanged, not substitute the driver name.
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    const driver = { getStackStatus: vi.fn().mockResolvedValue(null) };
    (app as unknown as { kernel: { registry: { getOrchestrator: () => unknown } } }).kernel.registry.getOrchestrator = () => driver;
    await app.inject({ method: 'GET', url: '/swarm/stacks', headers: asUser() });
    expect(driver.getStackStatus).toHaveBeenCalledWith('swarm');
    await app.close();
  });

  it('rejects unauthenticated callers on the list endpoint', async () => {
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('is operator-gated: a member cannot trigger host docker reads (403)', async () => {
    // Both endpoints execute host Docker daemon commands through the drivers
    // (`docker stack ls` / `docker service ls` / `docker compose ps`) — the
    // same host-privilege boundary as the exec terminal.
    const app = await buildTestApp();
    await app.register(orchestratorsRoutes);
    const driver = { getStackStatus: vi.fn().mockResolvedValue(null) };
    (app as unknown as { kernel: { registry: { getOrchestrator: () => unknown } } }).kernel.registry.getOrchestrator = () => driver;
    const res = await app.inject({
      method: 'GET',
      url: '/swarm/stacks',
      headers: asUser({ id: 7, isOperator: false }),
    });
    expect(res.statusCode).toBe(403);
    expect(driver.getStackStatus).not.toHaveBeenCalled();
    await app.close();
  });
});
