import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/lib/errors.js';

const infra = vi.hoisted(() => ({
  worker: vi.fn(async () => undefined),
  traefik: vi.fn(async () => undefined),
  collector: vi.fn(async () => undefined),
  backups: vi.fn(async () => undefined),
}));

// Background infra plugins would start real timers and run real docker commands;
// mock them as no-ops so the app under test stays hermetic.
vi.mock('../src/plugins/worker.js', () => ({ default: infra.worker }));
vi.mock('../src/plugins/traefik.js', () => ({ default: infra.traefik }));
vi.mock('../src/plugins/collector.js', () => ({ default: infra.collector }));
vi.mock('../src/plugins/backupScheduler.js', () => ({ default: infra.backups }));

const tmp = path.join(os.tmpdir(), `ninedeploy-app-${process.pid}-${Date.now()}`);
mkdirSync(tmp, { recursive: true });

type AppModule = typeof import('../src/app.js');

async function buildApp(envOverrides: Record<string, string> = {}): Promise<Awaited<ReturnType<AppModule['buildApp']>>> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NINEDEPLOY_DATA_DIR', tmp);
  vi.stubEnv('NINEDEPLOY_DB_PATH', path.join(tmp, 'ninedeploy.db'));
  for (const [k, v] of Object.entries(envOverrides)) vi.stubEnv(k, v);
  const mod = await import('../src/app.js');
  return mod.buildApp();
}

async function createUsersTable(app: Awaited<ReturnType<AppModule['buildApp']>>) {
  await app.db.run(sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
}

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildApp', () => {
  it('GET /health returns ok and pings the database', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.version).toBeTruthy();
    expect(typeof body.time).toBe('string');
    await app.close();
  });

  it('GET /v1/auth/status reports an uninitialized instance', async () => {
    const app = await buildApp();
    await createUsersTable(app);
    const res = await app.inject({ method: 'GET', url: '/v1/auth/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ initialized: false });
    await app.close();
  });

  it('turns ZodError into a 400 validation_error envelope', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ nope: true }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    expect(res.json().error.message).toBe('Request validation failed');
    expect(res.json().error.details).toBeDefined();
    await app.close();
  });

  it('returns the Fastify 404 envelope for unknown routes', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    // Fastify's default not-found handler answers directly (it bypasses the
    // custom error handler), so the body is the standard {message,error,statusCode}.
    expect(res.json()).toEqual({
      message: 'Route GET:/v1/does-not-exist not found',
      error: 'Not Found',
      statusCode: 404,
    });
    await app.close();
  });

  it('masks messages on 500 errors in production', async () => {
    const app = await buildApp({ NODE_ENV: 'production', NINEDEPLOY_JWT_SECRET: 'a-strong-production-secret-value' });
    const errorSpy = vi.spyOn(app.log, 'error');
    app.get('/boom', async () => {
      throw new Error('internal secret detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(errorSpy).toHaveBeenCalledWith({ err: expect.any(Error) }, 'request error');
    await app.close();
  });

  it('exposes the real message on 500 errors outside production', async () => {
    const app = await buildApp();
    app.get('/boom', async () => {
      throw new Error('visible detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'visible detail' } });
    await app.close();
  });

  it('uses the HttpError statusCode and code for 4xx errors', async () => {
    const app = await buildApp();
    app.get('/teapot', async () => {
      throw new HttpError(418, 'teapot', 'short and stout');
    });
    const res = await app.inject({ method: 'GET', url: '/teapot' });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: { code: 'teapot', message: 'short and stout' } });
    await app.close();
  });

  it('falls back to 500 when statusCode is outside the 400-599 range', async () => {
    const app = await buildApp();
    app.get('/weird', async () => {
      throw Object.assign(new Error('odd status'), { statusCode: 299 });
    });
    const res = await app.inject({ method: 'GET', url: '/weird' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('keeps 503 service-unavailable statuses', async () => {
    const app = await buildApp();
    app.get('/unavailable', async () => {
      throw new HttpError(503, 'unavailable', 'try later');
    });
    const res = await app.inject({ method: 'GET', url: '/unavailable' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('unavailable');
    await app.close();
  });
});
