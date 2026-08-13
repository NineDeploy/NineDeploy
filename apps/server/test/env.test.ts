import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'NODE_ENV',
  'NINEDEPLOY_HOST',
  'NINEDEPLOY_PORT',
  'NINEDEPLOY_DATA_DIR',
  'NINEDEPLOY_DB_PATH',
  'NINEDEPLOY_PUBLIC_URL',
  'NINEDEPLOY_JWT_SECRET',
  'NINEDEPLOY_JWT_ACCESS_TTL',
  'NINEDEPLOY_JWT_REFRESH_TTL',
  'NINEDEPLOY_MASTER_KEY',
] as const;

async function loadEnv() {
  vi.resetModules();
  const mod = await import('../src/env.js');
  return mod.env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('env', () => {
  it('applies defaults when nothing is set', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const env = await loadEnv();
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      NINEDEPLOY_HOST: '0.0.0.0',
      NINEDEPLOY_PORT: 3000,
      NINEDEPLOY_DATA_DIR: './.data',
      NINEDEPLOY_DB_PATH: './.data/ninedeploy.db',
      NINEDEPLOY_PUBLIC_URL: 'http://localhost:3000',
      NINEDEPLOY_JWT_SECRET: 'dev-insecure-secret-change-me',
      NINEDEPLOY_JWT_ACCESS_TTL: '15m',
      NINEDEPLOY_JWT_REFRESH_TTL: '7d',
    });
    expect('NINEDEPLOY_MASTER_KEY' in env).toBe(false);
  });

  it('parses valid custom values', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NINEDEPLOY_HOST', '127.0.0.1');
    vi.stubEnv('NINEDEPLOY_PORT', '8080');
    vi.stubEnv('NINEDEPLOY_DATA_DIR', '/tmp/ninedeploy-data');
    vi.stubEnv('NINEDEPLOY_DB_PATH', '/tmp/ninedeploy.db');
    vi.stubEnv('NINEDEPLOY_PUBLIC_URL', 'https://deploy.example.com');
    vi.stubEnv('NINEDEPLOY_JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('NINEDEPLOY_JWT_ACCESS_TTL', '30m');
    vi.stubEnv('NINEDEPLOY_JWT_REFRESH_TTL', '30d');
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', 'c'.repeat(64));

    const env = await loadEnv();
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      NINEDEPLOY_HOST: '127.0.0.1',
      NINEDEPLOY_PORT: 8080,
      NINEDEPLOY_DATA_DIR: '/tmp/ninedeploy-data',
      NINEDEPLOY_DB_PATH: '/tmp/ninedeploy.db',
      NINEDEPLOY_PUBLIC_URL: 'https://deploy.example.com',
      NINEDEPLOY_JWT_SECRET: 'x'.repeat(32),
      NINEDEPLOY_JWT_ACCESS_TTL: '30m',
      NINEDEPLOY_JWT_REFRESH_TTL: '30d',
      NINEDEPLOY_MASTER_KEY: 'c'.repeat(64),
    });
  });

  it('exits with code 1 and logs the error on invalid input', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubEnv('NINEDEPLOY_PORT', 'abc');
    const env = await loadEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(env).toBeUndefined();
  });

  it('exits when the public url is invalid', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubEnv('NINEDEPLOY_PUBLIC_URL', 'not-a-url');
    await loadEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('refuses to boot in production with the insecure default JWT secret', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubEnv('NODE_ENV', 'production');
    // NINEDEPLOY_JWT_SECRET left at the default.
    await loadEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/NINEDEPLOY_JWT_SECRET/);
  });

  it('boots in production when a strong custom JWT secret is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NINEDEPLOY_JWT_SECRET', 'a-strong-unique-production-secret');
    const env = await loadEnv();
    expect(env.NINEDEPLOY_JWT_SECRET).toBe('a-strong-unique-production-secret');
  });
});
