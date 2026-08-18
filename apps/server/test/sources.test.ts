import { describe, expect, it } from 'vitest';
import { sourcesRoutes } from '../src/modules/sources.js';
import { encrypt } from '../src/lib/crypto.js';
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

  it('creates a registry source with a username', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ insert: { sources: [sourceRow({ id: 10, type: 'registry', tokenEncrypted: 'enc', registryUsername: 'ci-bot' })] } }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { name: 'ghcr', type: 'registry', token: 'pat', registryUsername: 'ci-bot' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 10, type: 'registry', registryUsername: 'ci-bot', hasToken: true });
  });

  it('patches the registry username (empty string clears it)', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ update: { sources: [sourceRow({ id: 1, type: 'registry', registryUsername: null })] } }),
    });
    await app.register(sourcesRoutes);
    const res = await app.inject({
      method: 'PATCH',
      url: '/1',
      headers: asUser(),
      payload: { registryUsername: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().registryUsername).toBeNull();
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

  it('lists github repos for a configured source', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input: string | URL | Request) => {
        const u = typeof input === 'string' ? input : (input as any).url || input.toString();
        if (u.includes('github.com/user/repos')) {
          return {
            ok: true,
            json: async () => [
              { name: 'app', full_name: 'acme/app', clone_url: 'https://github.com/acme/app.git', default_branch: '', private: true },
            ],
          } as any;
        }
        return { ok: false } as any;
      };

      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 1, type: 'github', tokenEncrypted: encrypt('ghp_test') }),
          },
        }),
      });
      await app.register(sourcesRoutes);

      const resGh = await app.inject({ method: 'GET', url: '/1/repos', headers: asUser() });
      expect(resGh.statusCode).toBe(200);
      expect(resGh.json()).toEqual([
        { name: 'app', fullName: 'acme/app', url: 'https://github.com/acme/app.git', defaultBranch: 'main', isPrivate: true },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lists gitlab repos for a configured source', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input: string | URL | Request) => {
        const u = typeof input === 'string' ? input : (input as any).url || input.toString();
        if (u.includes('gitlab.com/api/v4/projects')) {
          return {
            ok: true,
            json: async () => [
              { name: 'gl-app', path_with_namespace: 'acme/gl-app', http_url_to_repo: 'https://gitlab.com/acme/gl-app.git', default_branch: '', visibility: 'public' },
            ],
          } as any;
        }
        return { ok: false } as any;
      };

      const appGl = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 2, type: 'gitlab', tokenEncrypted: encrypt('glpat_test') }),
          },
        }),
      });
      await appGl.register(sourcesRoutes);

      const resGl = await appGl.inject({ method: 'GET', url: '/2/repos', headers: asUser() });
      expect(resGl.statusCode).toBe(200);
      expect(resGl.json()).toEqual([
        { name: 'gl-app', fullName: 'acme/gl-app', url: 'https://gitlab.com/acme/gl-app.git', defaultBranch: 'main', isPrivate: false },
      ]);

      // Custom source type repos (returns empty)
      const appCustom = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 3, type: 'custom', tokenEncrypted: encrypt('custom_key') }),
          },
        }),
      });
      await appCustom.register(sourcesRoutes);
      const resCustom = await appCustom.inject({ method: 'GET', url: '/3/repos', headers: asUser() });
      expect(resCustom.statusCode).toBe(200);
      expect(resCustom.json()).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lists branches for a given github repository and other sources', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => [{ name: 'main' }, { name: 'feat/test' }],
      } as any);

      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 1, type: 'github', tokenEncrypted: encrypt('ghp_test') }),
          },
        }),
      });
      await app.register(sourcesRoutes);

      const res = await app.inject({
        method: 'GET',
        url: '/1/branches?repo=https://github.com/acme/app.git',
        headers: asUser(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(['main', 'feat/test']);

      // Non-github source branches
      const appCustom = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 3, type: 'custom', tokenEncrypted: encrypt('custom_key') }),
          },
        }),
      });
      await appCustom.register(sourcesRoutes);
      const resCustom = await appCustom.inject({ method: 'GET', url: '/3/branches?repo=foo', headers: asUser() });
      expect(resCustom.statusCode).toBe(200);
      expect(resCustom.json()).toEqual(['main', 'master']);

      // No repo query -> returns default
      const resDef = await app.inject({ method: 'GET', url: '/1/branches', headers: asUser() });
      expect(resDef.statusCode).toBe(200);
      expect(resDef.json()).toEqual(['main', 'master']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles non-ok responses from upstream git providers', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
      } as any);

      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 1, type: 'github', tokenEncrypted: encrypt('ghp_bad') }),
          },
        }),
      });
      await app.register(sourcesRoutes);

      const resGh = await app.inject({ method: 'GET', url: '/1/repos', headers: asUser() });
      expect(resGh.statusCode).toBe(200);
      expect(resGh.json()).toEqual([]);

      const appGl = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 2, type: 'gitlab', tokenEncrypted: encrypt('glpat_bad') }),
          },
        }),
      });
      await appGl.register(sourcesRoutes);
      const resGl = await appGl.inject({ method: 'GET', url: '/2/repos', headers: asUser() });
      expect(resGl.statusCode).toBe(200);
      expect(resGl.json()).toEqual([]);

      const resBr = await app.inject({ method: 'GET', url: '/1/branches?repo=acme/app', headers: asUser() });
      expect(resBr.statusCode).toBe(200);
      expect(resBr.json()).toEqual(['main', 'master']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles source errors gracefully when fetching repos and branches', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new Error('network down');
      };

      const appErr = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 1, type: 'github', tokenEncrypted: encrypt('ghp_test') }),
          },
        }),
      });
      await appErr.register(sourcesRoutes);
      const resErr = await appErr.inject({ method: 'GET', url: '/1/repos', headers: asUser() });
      expect(resErr.statusCode).toBe(200);
      expect(resErr.json()).toEqual([]);

      const appGlErr = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            sources: sourceRow({ id: 2, type: 'gitlab', tokenEncrypted: encrypt('glpat_test') }),
          },
        }),
      });
      await appGlErr.register(sourcesRoutes);
      const resGlErr = await appGlErr.inject({ method: 'GET', url: '/2/repos', headers: asUser() });
      expect(resGlErr.statusCode).toBe(200);
      expect(resGlErr.json()).toEqual([]);

      const resBrErr = await appErr.inject({ method: 'GET', url: '/1/branches?repo=acme/app', headers: asUser() });
      expect(resBrErr.statusCode).toBe(200);
      expect(resBrErr.json()).toEqual(['main', 'master']);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          sources: sourceRow({ id: 1, type: 'custom', tokenEncrypted: null }),
        },
      }),
    });
    await app.register(sourcesRoutes);

    const resRepos = await app.inject({ method: 'GET', url: '/1/repos', headers: asUser() });
    expect(resRepos.statusCode).toBe(200);
    expect(resRepos.json()).toEqual([]);

    const resBranches = await app.inject({ method: 'GET', url: '/1/branches', headers: asUser() });
    expect(resBranches.statusCode).toBe(200);
    expect(resBranches.json()).toEqual(['main', 'master']);

    // Missing source 404
    const app404 = await buildTestApp({ db: createFakeDb({ findFirst: { sources: null } }) });
    await app404.register(sourcesRoutes);
    const res404 = await app404.inject({ method: 'GET', url: '/99/repos', headers: asUser() });
    expect(res404.statusCode).toBe(404);
  });
});
