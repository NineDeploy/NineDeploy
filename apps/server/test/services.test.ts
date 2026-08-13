import { describe, expect, it, vi } from 'vitest';
import { servicesRoutes } from '../src/modules/services.js';
import { asUser, buildTestApp, createFakeDb, svcRow } from './helpers.js';

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(async () => 'line1\nline2'),
  run: vi.fn(async (_c: unknown, _a: unknown, _o: unknown, sink?: (l: string) => void) => { sink?.('out'); }),
}));
vi.mock('../src/lib/exec.js', () => execMocks);

const configMock = vi.hoisted(() => ({
  wildcardDomain: '',
  isProd: false,
  publicUrl: 'http://localhost:3000',
  paths: { dataDir: '/tmp', masterKeyFile: '/tmp/master.key' },
  jwt: { secret: 'x', accessTtl: '15m', refreshTtl: '7d' },
}));
vi.mock('../src/config.js', () => ({ config: configMock }));

const validCreate = {
  name: 'My App',
  type: 'docker',
  repoUrl: 'https://github.com/acme/app.git',
  branch: 'main',
  port: 8080,
  build: { buildPack: 'auto', baseDir: '/' },
};

describe('services routes', () => {
  it('lists services', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { services: [svcRow({ id: 1, name: 'web' })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ id: 1, name: 'web', autoUrl: null });
  });

  it('creates a service and its build config', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: { services: [svcRow({ id: 4, name: 'My App', slug: 'my-app' })] },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: validCreate });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 4, slug: 'my-app' });
  });

  it('creates a service without a port', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { services: [svcRow({ id: 4, port: null })] } }),
    });
    await app.register(servicesRoutes);
    const { port: _port, ...noPort } = validCreate;
    const res = await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: noPort });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 4, port: null });
  });

  it('creates a service with an explicit slug', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { services: [svcRow({ id: 4, slug: 'custom' })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { ...validCreate, slug: 'custom' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('custom');
  });

  it('returns 404 when the service insert fails', async () => {
    const app = await buildTestApp({ db: createFakeDb({ insert: { services: [] } }) });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: validCreate });
    expect(res.statusCode).toBe(404);
  });

  it('gets a service by id', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 3 }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/3', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(3);
  });

  it('returns 404 for a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('patches a service with and without a build section', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        update: { services: [svcRow({ id: 1, name: 'renamed' })] },
      }),
    });
    await app.register(servicesRoutes);
    const withBuild = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(),
      payload: { name: 'renamed', build: { buildPack: 'nixpacks' } },
    });
    expect(withBuild.statusCode).toBe(200);
    expect(withBuild.json()).toMatchObject({ id: 1, name: 'renamed' });
    const withoutBuild = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(), payload: { name: 'renamed' },
    });
    expect(withoutBuild.statusCode).toBe(200);
  });

  it('returns 404 when patching a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb({ update: { services: [] } }) });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/99', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('patches a service with an empty body', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ update: { services: [svcRow({ id: 1 })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1 });
  });

  it('deletes a service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
  });

  it('updates limits', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ update: { services: [svcRow({ id: 1, cpuShares: 512, memLimitMb: 1024 })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'PATCH', url: '/1/limits', headers: asUser(), payload: { cpuShares: 512, memLimitMb: 1024 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cpuShares: 512, memLimitMb: 1024 });
  });

  it('returns 404 when updating limits on a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb({ update: { services: [] } }) });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'PATCH', url: '/99/limits', headers: asUser(), payload: { cpuShares: 128 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('stops a running service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1', name: 'web' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/stop', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'stopped' });
    expect(execMocks.run).toHaveBeenCalledWith('docker', ['stop', '-t', '5', 'c1'], {}, expect.any(Function));
  });

  it('starts a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/start', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'running' });
  });

  it('restarts a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/restart', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'running' });
  });

  it('returns 404 when stopping an undeployed service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/stop', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when starting an undeployed service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/start', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when restarting an undeployed service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/restart', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('tolerates docker failures during stop', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('docker down'));
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/stop', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('tolerates docker failures during start', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('docker down'));
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/start', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('tolerates docker failures during restart', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('docker down'));
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/restart', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('returns container logs', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/logs', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ lines: 'line1\nline2' });
  });

  it('returns empty logs when docker fails', async () => {
    execMocks.capture.mockRejectedValueOnce(new Error('no such container'));
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/logs', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ lines: '' });
  });

  it('returns 404 for logs of an undeployed service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/logs', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid create payload', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('exposes an auto url when a wildcard domain is configured', async () => {
    configMock.wildcardDomain = 'example.com';
    try {
      const app = await buildTestApp({
        db: createFakeDb({ findMany: { services: [svcRow({ id: 1, slug: 'web' })] } }),
      });
      await app.register(servicesRoutes);
      const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].autoUrl).toBe('web.example.com');
    } finally {
      configMock.wildcardDomain = '';
    }
  });
});
