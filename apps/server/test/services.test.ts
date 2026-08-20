import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { servicesRoutes } from '../src/modules/services.js';
import { asUser, buildTestApp, createFakeDb, svcRow } from './helpers.js';

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(async () => 'line1\nline2'),
  run: vi.fn(async (_c: unknown, _a: unknown, _o: unknown, sink?: (l: string) => void) => { sink?.('out'); }),
}));
vi.mock('../src/lib/exec.js', () => execMocks);

const pm2Mocks = vi.hoisted(() => ({
  connect: vi.fn((cb: (err?: Error | null) => void) => cb(null)),
  disconnect: vi.fn(),
  stop: vi.fn((_name: string, cb: (err?: Error | null) => void) => cb(null)),
  restart: vi.fn((_name: string, cb: (err?: Error | null) => void) => cb(null)),
  delete: vi.fn((_name: string, cb: (err?: Error | null) => void) => cb(null)),
  describe: vi.fn((_name: string, cb: (err: Error | null, desc?: unknown[]) => void) => cb(null, [])),
}));
vi.mock('pm2', () => ({ default: pm2Mocks }));

const proxyMocks = vi.hoisted(() => ({
  writeDynamicConfig: vi.fn(async () => undefined),
  // docker.ts imports NETWORK from proxy.js; provide it so the mock stays complete.
  NETWORK: 'ninedeploy',
}));
vi.mock('../src/engine/proxy.js', () => proxyMocks);

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
  beforeEach(() => {
    // Isolate exec/pm2 call history per test (assertions like "not called with
    // docker logs" must not see earlier tests' calls).
    vi.clearAllMocks();
  });

  it('lists services', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { services: [svcRow({ id: 1, name: 'web' })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ id: 1, name: 'web', autoUrl: null });
  });

  it('scopes the list to a project when ?projectId= is a positive integer', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { services: [svcRow({ id: 1, name: 'web' })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/?projectId=2', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ id: 1, name: 'web' });
    // A non-numeric projectId is ignored (no scoping).
    const bad = await app.inject({ method: 'GET', url: '/?projectId=abc', headers: asUser() });
    expect(bad.statusCode).toBe(200);
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

  it('persists trusted command, socket and database mappings from a Hub template', async () => {
    let inserted: Record<string, unknown> | undefined;
    const app = await buildTestApp({
      db: createFakeDb({
        insert: {
          services: (value) => {
            inserted = value as Record<string, unknown>;
            return [svcRow({ id: 4, name: 'WordPress', slug: 'wordpress' })];
          },
        },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: {
        templateId: 'wordpress',
        name: 'WordPress',
        type: 'docker',
        image: 'wordpress:latest',
        port: 80,
        volumeMount: '/var/www/html',
        build: { buildPack: 'auto', baseDir: '/' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(inserted).toMatchObject({
      cmd: null,
      dockerSocket: false,
      templateDatabaseEnv: {
        WORDPRESS_DB_HOST: 'hostPort',
        WORDPRESS_DB_USER: 'username',
        WORDPRESS_DB_PASSWORD: 'password',
        WORDPRESS_DB_NAME: 'database',
      },
    });
  });

  it('returns 409-style 400 for a duplicate slug (including project-less rows)', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 9, slug: 'my-app' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: validCreate });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('slug_taken');
  });

  it('reuses a matching caller-owned idle service for a Hub retry', async () => {
    const existing = svcRow({
      id: 9,
      ownerUserId: 1,
      name: 'My App',
      slug: 'my-app',
      status: 'idle',
      repoUrl: 'https://github.com/acme/app.git',
      port: 8080,
      serverId: null,
    });
    const app = await buildTestApp({ db: createFakeDb({ findFirst: { services: existing } }) });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { ...validCreate, reuseExisting: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 9, slug: 'my-app', status: 'idle' });
  });

  it('repairs an older failed Hub service with the current trusted template database contract', async () => {
    let updated: Record<string, unknown> | undefined;
    const existing = svcRow({
      id: 17,
      ownerUserId: 1,
      name: 'Ghost',
      slug: 'ghost',
      status: 'error',
      type: 'docker',
      repoUrl: null,
      image: 'ghost:5-alpine',
      port: 2368,
      volumeMount: '/var/lib/ghost/content',
      templateDatabaseEnv: null,
      serverId: null,
    });
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: existing },
        update: { services: (value) => { updated = value as Record<string, unknown>; return [value as Record<string, unknown>]; } },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: {
        templateId: 'ghost',
        reuseExisting: true,
        name: 'Ghost',
        type: 'docker',
        image: 'ghost:5-alpine',
        port: 2368,
        volumeMount: '/var/lib/ghost/content',
        build: { buildPack: 'auto', baseDir: '/' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 17, status: 'error' });
    expect(updated?.templateDatabaseEnv).toMatchObject({
      database__connection__host: 'host',
      database__connection__password: 'password',
    });
  });

  it('does not reuse another user service or an already deployed service', async () => {
    for (const existing of [
      svcRow({ ownerUserId: 2, slug: 'my-app', repoUrl: 'https://github.com/acme/app.git', port: 8080, serverId: null }),
      svcRow({ ownerUserId: 1, slug: 'my-app', repoUrl: 'https://github.com/acme/app.git', port: 8080, serverId: null, status: 'running' }),
    ]) {
      const app = await buildTestApp({ db: createFakeDb({ findFirst: { services: existing } }) });
      await app.register(servicesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/',
        headers: asUser(),
        payload: { ...validCreate, reuseExisting: true },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    }
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

  it('creates a service with an explicit slug and publishedPort', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { services: [svcRow({ id: 4, slug: 'custom', publishedPort: 8080 })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { ...validCreate, slug: 'custom', publishedPort: 8080 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('custom');
    expect(res.json().publishedPort).toBe(8080);
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
    expect(res.json().build).toBeNull();
  });

  it('gets a service with its build config', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          services: svcRow({ id: 3 }),
          buildConfigs: {
            serviceId: 3, buildPack: 'dockerfile', baseDir: '/app', installCmd: null,
            buildCmd: 'npm run build', startCmd: 'npm start', dockerfilePath: './Dockerfile',
          },
        },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/3', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().build).toMatchObject({
      buildPack: 'dockerfile',
      baseDir: '/app',
      installCmd: null,
      buildCmd: 'npm run build',
      startCmd: 'npm start',
      dockerfilePath: './Dockerfile',
    });
  });

  it('returns 404 for a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'GET', url: '/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('patches the build config alongside the service row', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        update: {
          services: [svcRow({ id: 1, name: 'renamed' })],
          build_configs: [{ serviceId: 1, buildPack: 'nixpacks' }],
        },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(),
      payload: {
        name: 'renamed',
        build: {
          buildPack: 'nixpacks', baseDir: '/app', installCmd: 'npm ci',
          buildCmd: '', startCmd: 'npm start', dockerfilePath: '',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1, name: 'renamed' });
  });

  it('rewrites Traefik immediately when a running service container port is corrected', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'next-app-12', port: null }) },
        update: { services: [svcRow({ id: 1, runtimeId: 'next-app-12', port: 3000 })] },
      }),
    });
    await app.register(servicesRoutes);

    const res = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(), payload: { port: 3000 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().port).toBe(3000);
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalledWith(app.db);
  });

  it('patches restart policy and stop grace into the build config', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        update: { services: [svcRow()], build_configs: [{ serviceId: 1 }] },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(),
      payload: { build: { restartPolicy: 'on-failure:3', stopGraceSeconds: 20 } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('skips the build config write when the patch carries no build keys', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        update: { services: [svcRow({ id: 1 })], build_configs: [] },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(), payload: { build: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when patching a service whose build config row is missing', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow() },
        update: { services: [svcRow({ id: 1 })], build_configs: [] },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'PATCH', url: '/1', headers: asUser(), payload: { build: { startCmd: 'npm start' } },
    });
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
      payload: {
        name: 'renamed',
        previewDeploymentsEnabled: true,
        previewDomainPattern: 'pr-{{pr}}.local',
        build: {
          buildPack: 'nixpacks',
          preDeployCmd: 'npm run db:migrate',
          postDeployCmd: 'curl http://localhost/warmup',
          preStopCmd: 'npm run drain',
        },
      },
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
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1 }) }, update: { services: [svcRow({ id: 1 })] } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1 });
  });

  it('deletes a service', async () => {
    // No runtime id — covers the "nothing to retire" branch.
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, name: 'web' }) } }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
    expect(execMocks.run).not.toHaveBeenCalled();
  });

  it('tears a compose project down on delete', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, name: 'stack', type: 'compose', runtimeId: 'ndcmp-stack-api-1' }) },
      }),
    });
    // The compose stop path resolves the project from the container's own
    // compose labels (project + config file, tab-separated).
    execMocks.capture.mockResolvedValueOnce('ndcmp-stack\t/app/compose.yaml');
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
    const composeCall = execMocks.run.mock.calls.find((c) => (c[1] as string[])[0] === 'compose');
    expect(composeCall).toBeTruthy();
    expect((composeCall![1] as string[])).toEqual(['compose', '-p', 'ndcmp-stack', '-f', '/app/compose.yaml', 'down', '--remove-orphans']);
  });

  it('stops and removes the docker container and rewrites traefik config on delete', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, name: 'web', type: 'docker', runtimeId: 'c1' }) },      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
    expect(execMocks.run).toHaveBeenCalledWith('docker', ['stop', '-t', '5', 'c1'], {}, expect.any(Function));
    expect(execMocks.run).toHaveBeenCalledWith('docker', ['rm', '-f', 'c1'], {}, expect.any(Function));
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('deletes a pm2 service through the pm2 daemon and rewrites traefik config', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, name: 'api', type: 'pm2', runtimeId: 'api-1' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
    expect(pm2Mocks.delete).toHaveBeenCalledWith('api-1', expect.any(Function));
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('returns 404 when deleting a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('deletes the row even when rewriting traefik config fails', async () => {
    proxyMocks.writeDynamicConfig.mockRejectedValueOnce(new Error('yaml write failed'));
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, name: 'web', type: 'docker', runtimeId: 'c1' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
  });

  it('updates limits', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1 }) }, update: { services: [svcRow({ id: 1, cpuShares: 512, memLimitMb: 1024 })] } }),
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

  it('stops a pm2 service through the pm2 daemon, not docker', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2', name: 'api' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/stop', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'stopped' });
    expect(pm2Mocks.stop).toHaveBeenCalledWith('api-1', expect.any(Function));
    expect(execMocks.run).not.toHaveBeenCalledWith('docker', expect.arrayContaining(['stop']));
  });

  it('starts a pm2 service through the pm2 daemon', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/start', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'running' });
    expect(pm2Mocks.restart).toHaveBeenCalledWith('api-1', expect.any(Function));
  });

  it('restarts a pm2 service through the pm2 daemon', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/restart', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'running' });
    expect(pm2Mocks.restart).toHaveBeenCalledWith('api-1', expect.any(Function));
  });

  it('tolerates pm2 daemon failures during stop', async () => {
    pm2Mocks.stop.mockImplementationOnce((_n: string, cb: (err?: Error | null) => void) =>
      cb(new Error('daemon down')));
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/stop', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('tolerates pm2 daemon failures during start', async () => {
    pm2Mocks.restart.mockImplementationOnce((_n: string, cb: (err?: Error | null) => void) =>
      cb(new Error('daemon down')));
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/start', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('tolerates pm2 daemon failures during restart', async () => {
    pm2Mocks.restart.mockImplementationOnce((_n: string, cb: (err?: Error | null) => void) =>
      cb(new Error('daemon down')));
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/restart', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('rejects lifecycle ops for an unsupported service type', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, runtimeId: 'x-1', type: 'k8s' }) },
      }),
    });
    await app.register(servicesRoutes);
    for (const op of ['stop', 'start', 'restart']) {
      const res = await app.inject({ method: 'POST', url: `/1/${op}`, headers: asUser() });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('bad_request');
    }
    // Neither the docker CLI nor the pm2 daemon was touched.
    expect(execMocks.run).not.toHaveBeenCalled();
    expect(pm2Mocks.stop).not.toHaveBeenCalled();
    expect(pm2Mocks.restart).not.toHaveBeenCalled();
  });

  it('deletes a service of an unsupported type without touching its runtime', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, name: 'odd', type: 'k8s', runtimeId: 'x-1' }) },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(204);
    expect(execMocks.run).not.toHaveBeenCalled();
    expect(pm2Mocks.delete).not.toHaveBeenCalled();
    expect(proxyMocks.writeDynamicConfig).toHaveBeenCalled();
  });

  it('returns pm2 process logs from the daemon log files', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nd-pm2logs-'));
    const out = path.join(dir, 'out.log');
    const err = path.join(dir, 'err.log');
    writeFileSync(out, 'line1\nline2\nline3\n');
    writeFileSync(err, 'boom\n');
    pm2Mocks.describe.mockImplementationOnce((_n: string, cb: (err: Error | null, desc?: unknown[]) => void) =>
      cb(null, [{ name: 'api-1', pm2_env: { pm_out_log_path: out, pm_err_log_path: err } }]));
    try {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, runtimeId: 'api-1', type: 'pm2' }) },
        }),
      });
      await app.register(servicesRoutes);
      const res = await app.inject({ method: 'GET', url: '/1/logs', headers: asUser() });
      expect(res.statusCode).toBe(200);
      // Structural, not exact: the log bus may reorder/tail lines without the
      // test breaking (the join of out+err is an implementation detail).
      const lines = res.json().lines as string;
      expect(lines).toContain('line1');
      expect(lines).toContain('line2');
      expect(lines).toContain('line3');
      expect(lines).toContain('boom');
      expect(lines.split('\n')).toHaveLength(4);
      expect(execMocks.capture).not.toHaveBeenCalledWith('docker', expect.arrayContaining(['logs']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clones an existing service with its build configs and env vars', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          services: svcRow({ id: 1, name: 'original-svc', slug: 'orig-svc' }),
          buildConfigs: { serviceId: 1, buildPack: 'nixpacks' } as any,
        },
        findMany: {
          envVars: [{ id: 1, serviceId: 1, key: 'PORT', valueEncrypted: 'enc', scope: 'service', scopeKey: null }] as any,
        },
        insert: {
          services: [svcRow({ id: 2, name: 'original-svc (Copy)', slug: 'orig-svc-copy' })],
          buildConfigs: [{ id: 2, serviceId: 2, buildPack: 'nixpacks' }] as any,
          envVars: [{ id: 2, serviceId: 2, key: 'PORT' }] as any,
        },
      }),
    });
    await app.register(servicesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/clone',
      headers: asUser(),
      payload: { name: 'cloned-app' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 2, name: 'original-svc (Copy)' });

    // 404 for missing service
    const app404 = await buildTestApp({ db: createFakeDb({ findFirst: { services: null } }) });
    await app404.register(servicesRoutes);
    const res404 = await app404.inject({ method: 'POST', url: '/99/clone', headers: asUser() });
    expect(res404.statusCode).toBe(404);
  });
});
