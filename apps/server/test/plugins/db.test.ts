import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';

const tmp = path.join(os.tmpdir(), `ninedeploy-db-plugin-${process.pid}-${Date.now()}`);
mkdirSync(tmp, { recursive: true });

vi.stubEnv('NINEDEPLOY_DATA_DIR', tmp);
vi.stubEnv('NINEDEPLOY_DB_PATH', path.join(tmp, 'ninedeploy.db'));

const dbPlugin = (await import('../../src/plugins/db.js')).default;

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe('db plugin', () => {
  it('decorates fastify.db when registered', async () => {
    const app = Fastify();
    await app.register(dbPlugin);
    expect(app.db).toBeDefined();
    expect(typeof app.db.select).toBe('function');
    expect(typeof app.db.insert).toBe('function');
    expect(typeof app.db.query).toBe('object');
    await app.close();
  });

  it('can be registered twice and only decorates once', async () => {
    const app = Fastify();
    await app.register(dbPlugin);
    const first = app.db;
    await app.register(dbPlugin);
    expect(app.db).toBe(first);
    await app.close();
  });

  it('keeps an existing decoration untouched', async () => {
    const app = Fastify();
    const fake = { select: vi.fn() };
    app.decorate('db', fake);
    await app.register(dbPlugin);
    expect(app.db).toBe(fake);
    await app.close();
  });
});
