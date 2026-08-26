import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import rateLimitPlugin from '../../src/plugins/rateLimit.js';

describe('rateLimitPlugin', () => {
  it('rejects with 429 once a per-route ceiling is exceeded', async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimitPlugin);
    app.post(
      '/sensitive',
      { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
      async () => ({ ok: true }),
    );

    expect((await app.inject({ method: 'POST', url: '/sensitive' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/sensitive' })).statusCode).toBe(200);
    const blocked = await app.inject({ method: 'POST', url: '/sensitive' });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it('counts buckets independently per route', async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimitPlugin);
    app.post('/a', { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
    app.post('/b', { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } }, async () => ({ ok: true }));

    expect((await app.inject({ method: 'POST', url: '/a' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/a' })).statusCode).toBe(429);
    // Different route — independent bucket, still allowed.
    expect((await app.inject({ method: 'POST', url: '/b' })).statusCode).toBe(200);
    await app.close();
  });
});
