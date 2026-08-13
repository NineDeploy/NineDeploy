import { describe, expect, it } from 'vitest';
import { topologyRoutes } from '../src/modules/topology.js';
import { asUser, attachmentRow, buildTestApp, createFakeDb, dbRow, domainRow, svcRow } from './helpers.js';

describe('topology routes', () => {
  it('assembles the workspace graph from all four tables', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        select: {
          services: [svcRow({ id: 2, name: 'api', slug: 'api', type: 'pm2', status: 'running' })],
          databases: [dbRow({ id: 3, name: 'redis', engine: 'redis' })],
          database_attachments: [attachmentRow({ id: 4, serviceId: 2, databaseId: 3, envAlias: 'REDIS_URL' })],
          domains: [domainRow({ id: 5, serviceId: 2, hostname: 'api.example.com' })],
        },
      }),
    });
    await app.register(topologyRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      services: [{ id: 2, name: 'api', slug: 'api', type: 'pm2', status: 'running' }],
      databases: [{ id: 3, name: 'redis', engine: 'redis', status: 'running' }],
      attachments: [{ id: 4, serviceId: 2, databaseId: 3, envAlias: 'REDIS_URL' }],
      domains: [{ id: 5, serviceId: 2, hostname: 'api.example.com' }],
    });
  });

  it('returns empty graphs when nothing exists', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(topologyRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ services: [], databases: [], attachments: [], domains: [] });
  });
});
