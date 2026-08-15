import { describe, expect, it } from 'vitest';
import { templateRoutes } from '../src/modules/templates.js';
import { asUser, buildTestApp, createFakeDb, depRow, svcRow } from './helpers.js';

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

  it('returns 404 when deploying an unknown template', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(templateRoutes);
    const res = await app.inject({ method: 'POST', url: '/nope/deploy', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });
});
