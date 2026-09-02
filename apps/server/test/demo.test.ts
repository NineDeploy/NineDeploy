import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoRoutes } from '../src/modules/demo.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

const auditMocks = vi.hoisted(() => ({ audit: vi.fn(async () => undefined) }));
vi.mock('../src/lib/audit.js', () => auditMocks);

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

  it('creates ONE real demo service and queues its first build when nothing exists yet', async () => {
    let queuedValues: Record<string, unknown> | undefined;
    let serviceValues: Record<string, unknown> | undefined;
    const app = await appWith({
      findFirst: {
        projects: null,
        services: null,
        workspaces: null,
      },
      findMany: {
        workspaces: [],
      },
      insert: {
        projects: [{ id: 10, name: 'Next.js Demo', slug: 'nextjs-demo' }],
        services: (values: Record<string, unknown>) => {
          serviceValues = values;
          return [
            {
              id: 30,
              name: values.name,
              slug: values.slug,
              type: values.type,
              status: values.status,
              port: values.port,
            },
          ];
        },
        build_configs: [{ serviceId: 30 }],
        deployments: (values: Record<string, unknown>) => {
          queuedValues = values;
          return [{ id: 50, ...values }];
        },
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
    expect(body.projectName).toBe('Next.js Demo');
    // Exactly ONE service, real state (idle — nothing is pretending to run),
    // built from the pinned public repo via its own Dockerfile.
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({
      id: 30,
      name: 'Next.js Demo',
      type: 'docker',
      status: 'idle',
      port: 3000,
    });
    expect(body.database).toBeNull();
    // The service row carries the pinned repo and its host port.
    expect(serviceValues?.repoUrl).toBe('https://github.com/ersinkoc/nextjs-test');
    expect(serviceValues?.publishedPort).toBe(3000);
    expect(serviceValues?.healthPath).toBe('/api/health');
    // And the first deployment is QUEUED for the deploy worker — the seed
    // must result in a real build, not fake rows.
    expect(queuedValues?.status).toBe('queued');
    expect(auditMocks.audit).toHaveBeenCalled();
  });

  it('re-seed is idempotent: returns the existing service and queues nothing', async () => {
    let deploymentsInserted = 0;
    const app = await appWith({
      findFirst: {
        projects: { id: 10, name: 'Next.js Demo', slug: 'nextjs-demo' },
        services: {
          id: 30,
          name: 'Next.js Demo',
          slug: 'nextjs-demo',
          type: 'docker',
          status: 'running',
          port: 3000,
        },
      },
      findMany: {
        workspaces: [],
      },
      insert: {
        deployments: (values: Record<string, unknown>) => {
          deploymentsInserted += 1;
          return [{ id: 50, ...values }];
        },
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
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({ id: 30, status: 'running' });
    expect(body.database).toBeNull();
    // The build was already queued on the first seed — a re-seed must not
    // queue another one (or duplicate the project/workspace tags).
    expect(deploymentsInserted).toBe(0);
  });
});
