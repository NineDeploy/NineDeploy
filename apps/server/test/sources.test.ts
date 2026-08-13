import { describe, expect, it } from 'vitest';
import { sourcesRoutes } from '../src/modules/sources.js';
import { asUser, buildTestApp, createFakeDb, sourceRow } from './helpers.js';

describe('sources routes', () => {
  it('lists sources with token/deploy-key presence flags', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          sources: [
            sourceRow({ id: 1, tokenEncrypted: 'enc', deployKeyEncrypted: null }),
            sourceRow({ id: 2, tokenEncrypted: null, deployKeyEncrypted: 'enc' }),
          ],
        },
      }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows[0]).toMatchObject({ id: 1, hasToken: true, hasDeployKey: false });
    expect(rows[1]).toMatchObject({ id: 2, hasToken: false, hasDeployKey: true });
    expect(rows[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('creates a source encrypting provided credentials', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        insert: { sources: [sourceRow({ id: 9, name: 'repo', tokenEncrypted: 'enc', deployKeyEncrypted: 'enc' })] },
      }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'repo', type: 'github', token: 'tok', deployKey: 'key', defaultBranch: 'dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 9, name: 'repo', type: 'github', hasToken: true, hasDeployKey: true });
  });

  it('creates a source with no credentials (default branch main)', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { sources: [sourceRow({ id: 9, tokenEncrypted: null, deployKeyEncrypted: null })] } }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'repo', type: 'custom' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 9, hasToken: false, hasDeployKey: false });
  });

  it('patches name, branch, token and deploy key', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ update: { sources: [sourceRow({ id: 1, name: 'renamed', defaultBranch: 'dev' })] } }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1',
      headers: asUser(),
      payload: { name: 'renamed', defaultBranch: 'dev', token: 't', deployKey: 'k' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1, name: 'renamed' });
  });

  it('patches a source with an empty body', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ update: { sources: [sourceRow({ id: 1 })] } }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 1 });
  });

  it('clears a credential when an empty string is sent', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ update: { sources: [sourceRow({ id: 1, tokenEncrypted: null, deployKeyEncrypted: null })] } }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1',
      headers: asUser(),
      payload: { token: '', deployKey: '' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when patching a missing source', async () => {
    const app = await buildTestApp({ db: createFakeDb({ update: { sources: [] } }) });
    await app.register(sourcesRoutes);
    const res = await app.inject({ method: 'PATCH', url: '/99', headers: asUser(), payload: { name: 'x' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('deletes a source', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(sourcesRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejects a non-admin member with 403 (sources are admin-only)', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { ...asUser(), 'x-test-role': 'member' },
    });
    expect(res.statusCode).toBe(403);
  });
});
