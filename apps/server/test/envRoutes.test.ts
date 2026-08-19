import { describe, expect, it } from 'vitest';
import { encrypt } from '../src/lib/crypto.js';
import { envRoutes } from '../src/modules/env.js';
import { asUser, buildTestApp, createFakeDb, envVarRow } from './helpers.js';

describe('env routes (src/modules/env.ts)', () => {
  it('lists env vars, decrypting non-secret values and masking secrets', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: { id: 1 } },
        findMany: {
          envVars: [
            envVarRow({ id: 1, key: 'PORT', valueEncrypted: encrypt('8080'), isSecret: false }),
            envVarRow({ id: 2, key: 'TOKEN', valueEncrypted: encrypt('hunter2'), isSecret: true }),
          ],
        },
      }),
    });
    await app.register(envRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/env', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: 1, key: 'PORT', value: '8080', isSecret: false },
      { id: 2, key: 'TOKEN', value: '', isSecret: true },
    ]);
  });

  it('creates an env var', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: { id: 1 } }, insert: { env_vars: [envVarRow({ id: 3, key: 'NODE_ENV', isSecret: false, valueEncrypted: encrypt('production') })] } }),
    });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/env',
      headers: asUser(),
      payload: { key: 'NODE_ENV', value: 'production', isSecret: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 3, key: 'NODE_ENV', isSecret: false });
  });

  it('returns 400 when the key already exists', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: { id: 1 } }, insert: { env_vars: () => { throw new Error('UNIQUE constraint'); } } }),
    });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/env',
      headers: asUser(),
      payload: { key: 'PORT', value: '1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('overwrites an existing env var during a retryable Hub deploy', async () => {
    const existing = envVarRow({ id: 3, serviceId: 1, key: 'TOKEN', valueEncrypted: encrypt('old'), isSecret: true });
    const updated = envVarRow({ id: 3, serviceId: 1, key: 'TOKEN', valueEncrypted: encrypt('new'), isSecret: true });
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: { id: 1 }, envVars: existing }, update: { env_vars: [updated] } }),
    });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/env',
      headers: asUser(),
      payload: { key: 'TOKEN', value: 'new', isSecret: true, overwriteExisting: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 3, key: 'TOKEN', isSecret: true });
  });

  it('updates an env var', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: { id: 1 } }, update: { env_vars: [envVarRow({ id: 3, key: 'PORT', isSecret: true, valueEncrypted: encrypt('9999') })] } }),
    });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/env/3',
      headers: asUser(),
      payload: { key: 'PORT', value: '9999', isSecret: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 3, key: 'PORT', value: '', isSecret: true });
  });

  it('returns 404 when updating a missing env var', async () => {
    const app = await buildTestApp({ db: createFakeDb({ update: { env_vars: [] } }) });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1/env/99',
      headers: asUser(),
      payload: { key: 'PORT', value: '1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when creating an env var for a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'POST', url: '/99/env', headers: asUser(),
      payload: { key: 'PORT', value: '1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Service not found');
  });

  it('deletes an env var', async () => {
    const app = await buildTestApp({ db: createFakeDb({ findFirst: { services: { id: 1 } } }) });
    await app.register(envRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1/env/3', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejects an invalid payload with a validation envelope', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(envRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/1/env',
      headers: asUser(),
      payload: { value: 'missing-key' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('rejects env keys whose charset would break docker --env-file', async () => {
    const app = await buildTestApp({ db: createFakeDb({ findFirst: { services: { id: 1 } } }) });
    await app.register(envRoutes);
    const create = await app.inject({
      method: 'POST', url: '/1/env', headers: asUser(), payload: { key: 'MY VAR', value: 'x' },
    });
    expect(create.statusCode).toBe(400);
    expect(create.json().error.code).toBe('validation_error');
    const update = await app.inject({
      method: 'PATCH', url: '/1/env/3', headers: asUser(), payload: { key: '1BAD', value: 'x' },
    });
    expect(update.statusCode).toBe(400);
    expect(update.json().error.code).toBe('validation_error');
  });

  it('trims surrounding whitespace from env keys', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: { id: 1 } },
        insert: { env_vars: [envVarRow({ id: 3, key: 'PORT', isSecret: false, valueEncrypted: encrypt('3000') })] },
      }),
    });
    await app.register(envRoutes);
    // `  PORT  ` would fail the charset check if it were not trimmed first.
    const res = await app.inject({
      method: 'POST', url: '/1/env', headers: asUser(), payload: { key: '  PORT  ', value: '3000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 3, key: 'PORT' });
  });
});
