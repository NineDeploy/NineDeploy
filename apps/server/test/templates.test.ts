import { describe, expect, it, vi } from 'vitest';
import { templateRoutes } from '../src/modules/templates.js';
import { asUser, buildTestApp, createFakeDb, dbRow, depRow, svcRow } from './helpers.js';

const databaseMocks = vi.hoisted(() => ({
  startDatabase: vi.fn(async () => undefined),
  defaultPort: vi.fn(() => 3306),
  ENGINES: {
    mysql: { username: () => 'root', dbName: () => 'app' },
    postgres: { username: () => 'nine', dbName: () => 'app' },
  },
}));
vi.mock('../src/engine/database.js', () => databaseMocks);

describe('template routes', () => {
  it('lists template summaries', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]).toMatchObject({ id: 'n8n', name: 'n8n', category: 'Automation' });
    expect(rows[0]).not.toHaveProperty('description');
  });

  it('returns a full template by id', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'GET', url: '/n8n', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'n8n', image: 'n8nio/n8n', port: 5678 });
  });

  it('returns 404 for an unknown template', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'GET', url: '/nope', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('generates fresh secrets for secret env values on one-click deploys', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: {
          services: [svcRow({ id: 7, name: 'Grafana', slug: 'grafana-0001' })],
          deployments: [depRow({ id: 8 })],
          env_vars: [{ id: 1, key: 'GF_SECURITY_ADMIN_PASSWORD', valueEncrypted: 'x', isSecret: true }],
        },
      }),
    });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/grafana/deploy', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The generated secret is returned once and is NOT the registry default.
    expect(body.generatedSecrets).toHaveLength(1);
    expect(body.generatedSecrets[0]).toMatchObject({ key: 'GF_SECURITY_ADMIN_PASSWORD' });
    expect(body.generatedSecrets[0].value).not.toBe('admin');
    expect(body.generatedSecrets[0].value.length).toBeGreaterThanOrEqual(16);
  });

  it('deploys a template with env vars and a secret', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: {
          services: [svcRow({ id: 7, name: 'Grafana', slug: 'grafana-0001' })],
          deployments: [depRow({ id: 8 })],
          env_vars: [{ id: 1, key: 'GF_SECURITY_ADMIN_PASSWORD', valueEncrypted: 'x', isSecret: true }],
        },
      }),
    });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/grafana/deploy', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ serviceId: 7, deploymentId: 8 });
  });

  it('deploys a template with a non-secret env var', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: {
          services: [svcRow({ id: 7, name: 'Vaultwarden', slug: 'vaultwarden-0001' })],
          deployments: [depRow({ id: 8 })],
          env_vars: [{ id: 1, key: 'ROCKET_PORT', valueEncrypted: 'x', isSecret: false }],
        },
      }),
    });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/vaultwarden/deploy', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('deploys a template with no env section', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: { services: [svcRow({ id: 7, name: 'n8n', slug: 'n8n-0001' })], deployments: [depRow({ id: 8 })] },
      }),
    });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/n8n/deploy', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ serviceId: 7, deploymentId: 8 });
  });

  it('deploys a template without a volume mount', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: {
          services: [svcRow({ id: 7, name: 'Excalidraw', slug: 'excalidraw-0001', volumeMount: null })],
          deployments: [depRow({ id: 8 })],
        },
      }),
    });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/excalidraw/deploy', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ serviceId: 7, deploymentId: 8 });
  });

  it('provisions and attaches the managed database before a CLI template deploy', async () => {
    let serviceInsert: Record<string, unknown> | undefined;
    let attachmentInsert: Record<string, unknown> | undefined;
    const app = await buildTestApp({
      db: createFakeDb({
        insert: {
          services: (value) => {
            serviceInsert = value as Record<string, unknown>;
            return [svcRow({ id: 7, name: 'WordPress', slug: 'wordpress-0001' })];
          },
          databases: (value) => [dbRow({ ...(value as Record<string, unknown>), id: 9 })],
          database_attachments: (value) => {
            attachmentInsert = value as Record<string, unknown>;
            return [{ id: 11, ...(value as Record<string, unknown>) }];
          },
          deployments: [depRow({ id: 8 })],
        },
      }),
    });
    await app.register(templateRoutes);

    const res = await app.inject({ method: 'POST', url: '/wordpress/deploy', headers: asUser() });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ serviceId: 7, deploymentId: 8, databaseId: 9 });
    expect(serviceInsert?.templateDatabaseEnv).toEqual({
      WORDPRESS_DB_HOST: 'hostPort',
      WORDPRESS_DB_USER: 'username',
      WORDPRESS_DB_PASSWORD: 'password',
      WORDPRESS_DB_NAME: 'database',
    });
    expect(databaseMocks.startDatabase).toHaveBeenCalledOnce();
    expect(attachmentInsert).toMatchObject({ serviceId: 7, databaseId: 9, envAlias: 'DATABASE_URL' });
  });

  it('returns 404 when deploying an unknown template', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/nope/deploy', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });
});
