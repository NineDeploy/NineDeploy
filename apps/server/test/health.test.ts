import { describe, expect, it } from 'vitest';
import { healthRoutes } from '../src/modules/health.js';
import { VERSION } from '../src/version.js';
import { buildTestApp, createFakeDb } from './helpers.js';

describe('health routes', () => {
  it('reports ok when the db ping succeeds', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.version).toBe(VERSION);
    expect(typeof body.time).toBe('string');
  });

  it('reports degraded when the db ping fails', async () => {
    const app = await buildTestApp({ db: createFakeDb({ runError: true }) });
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('degraded');
    expect(res.json().db).toBe('error');
  });
});
