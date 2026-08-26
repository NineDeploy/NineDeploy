import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoRoutes } from '../src/modules/demo.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

const auditMocks = vi.hoisted(() => ({ audit: vi.fn(async () => undefined) }));
vi.mock('../src/lib/audit.js', () => auditMocks);

const cryptoMocks = vi.hoisted(() => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  randomToken: vi.fn(() => 'demo-rand-24-char-secret'),
}));
vi.mock('../src/lib/crypto.js', () => cryptoMocks);

const appWith = async (fixtures: Record<string, unknown>) => {
  const app = await buildTestApp({ db: createFakeDb(fixtures as never) });
  await app.register(demoRoutes, { prefix: '/demo' });
  return app;
};

describe('demo routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires authentication', async () => {
    const app = await appWith({});
    const res = await app.inject({ method: 'POST', url: '/demo/seed' });
    expect(res.statusCode).toBe(401);
  });

  it('seeds demo environment when nothing exists yet', async () => {
    const app = await appWith({
      findFirst: {
        projects: null,
        databases: null,
        services: null,
      },
      insert: {
        projects: [{ id: 10, name: 'Next.js Demo Stack', slug: 'nextjs-demo-stack' }],
        databases: [{ id: 20, name: 'demo-postgres', slug: 'demo-postgres', engine: 'postgres' }],
        services: (val: any) => [
          {
            id: val.slug === 'nextjs-docker-app' ? 30 : 31,
            name: val.name,
            slug: val.slug,
            type: val.type,
            status: val.status,
            port: val.port,
          },
        ],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/demo/seed',
      headers: asUser(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.projectName).toBe('Next.js Demo Stack');
    expect(body.database).toMatchObject({ id: 20, name: 'demo-postgres', engine: 'postgres' });
    expect(body.services).toHaveLength(2);
    expect(body.services[0]).toMatchObject({ id: 30, name: 'Next.js Docker App', type: 'docker', port: 80 });
    expect(body.services[1]).toMatchObject({ id: 31, name: 'Next.js PM2 Service', type: 'pm2', port: 3001 });
    expect(auditMocks.audit).toHaveBeenCalled();
    // The demo DB password is a per-seed random token — never a hardcoded
    // credential — and the connection string embeds it URL-encoded.
    expect(cryptoMocks.randomToken).toHaveBeenCalledWith(24);
    expect(cryptoMocks.encrypt).toHaveBeenCalledWith(
      'postgres://nine:demo-rand-24-char-secret@nd-db-demo-postgres:5432/app',
    );
  });

  it('reuses existing demo project, database and services on subsequent calls', async () => {
    const existingProject = { id: 10, name: 'Next.js Demo Stack', slug: 'nextjs-demo-stack' };
    const existingDb = { id: 20, name: 'demo-postgres', slug: 'demo-postgres', engine: 'postgres' };
    const existingDocker = { id: 30, name: 'Next.js Docker App', slug: 'nextjs-docker-app', type: 'docker', status: 'running', port: 3000 };
    const existingPm2 = { id: 31, name: 'Next.js PM2 Service', slug: 'nextjs-pm2-service', type: 'pm2', status: 'running', port: 3001 };

    let serviceLookupCount = 0;

    const fakeDb = createFakeDb({
      findFirst: {
        projects: existingProject,
        databases: existingDb,
        services: () => {
          serviceLookupCount++;
          return serviceLookupCount === 1 ? existingDocker : existingPm2;
        },
      },
    } as never);

    const app = await buildTestApp({ db: fakeDb });
    await app.register(demoRoutes, { prefix: '/demo' });

    const res = await app.inject({
      method: 'POST',
      url: '/demo/seed',
      headers: asUser(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(10);
    expect(body.database?.id).toBe(20);
    expect(body.services).toHaveLength(2);
    expect(body.services[0].id).toBe(30);
    expect(body.services[1].id).toBe(31);
  });

  it('handles partial existence (project exists, database created; docker exists, pm2 created)', async () => {
    const existingProject = { id: 10, name: 'Next.js Demo Stack', slug: 'nextjs-demo-stack' };
    const existingDocker = { id: 30, name: 'Next.js Docker App', slug: 'nextjs-docker-app', type: 'docker', status: 'running', port: 3000 };

    let serviceLookupCount = 0;
    const fakeDb = createFakeDb({
      findFirst: {
        projects: existingProject,
        databases: null,
        services: () => {
          serviceLookupCount++;
          return serviceLookupCount === 1 ? existingDocker : null;
        },
      },
      insert: {
        databases: [{ id: 20, name: 'demo-postgres', slug: 'demo-postgres', engine: 'postgres' }],
        services: [{ id: 31, name: 'Next.js PM2 Service', slug: 'nextjs-pm2-service', type: 'pm2', status: 'running', port: 3001 }],
      },
    } as never);

    const app = await buildTestApp({ db: fakeDb });
    await app.register(demoRoutes, { prefix: '/demo' });

    const res = await app.inject({
      method: 'POST',
      url: '/demo/seed',
      headers: asUser(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.database?.id).toBe(20);
    expect(body.services).toHaveLength(2);
    expect(body.services[0].id).toBe(30);
    expect(body.services[1].id).toBe(31);
  });
});
