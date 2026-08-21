import { describe, expect, it } from 'vitest';
import { configCenterRoutes } from '../src/modules/configCenter.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

describe('Config Center HTTP API', () => {
  it('lists, gets, sets, and deletes config entries with role security and masking', async () => {
    const store = new Map<string, any>();
    const findEntry = (args: any) => {
      if (!args) return undefined;
      for (const [k, v] of store.entries()) {
        if (args === k || args?.where === k) return v;
        const chunks = args?.where?.queryChunks ?? args?.queryChunks;
        if (Array.isArray(chunks)) {
          for (const chunk of chunks) {
            if (chunk === k || chunk?.value === k || (Array.isArray(chunk?.value) && chunk.value.includes(k))) return v;
          }
        }
        if (args?.where?.value === k || args?.where?.right?.value === k || args?.where?.left?.value === k) return v;
        try {
          if (JSON.stringify(args).includes(k)) return v;
        } catch {}
      }
      return undefined;
    };

    const fakeDb = createFakeDb({
      findFirst: {
        configEntries: ((args: any) => findEntry(args)) as any,
      },
      findMany: {
        configEntries: (() => Array.from(store.values())) as any,
      },
      insert: {
        config_entries: ((val: any) => {
          store.set(val.key, val);
          return [val];
        }) as any,
        configEntries: ((val: any) => {
          store.set(val.key, val);
          return [val];
        }) as any,
      },
      delete: {
        config_entries: () => [],
        configEntries: () => [],
      },
    });

    const app = await buildTestApp({ db: fakeDb });
    await app.register(configCenterRoutes);

    // 1. Register a static definition in the kernel
    app.kernel.configCenter.registerDefinition({
      key: 'system.site_name',
      type: 'string',
      isSecret: false,
      label: 'Site Name',
      category: 'general',
      defaultValue: 'NineDeploy Instance',
    });

    app.kernel.configCenter.registerDefinition({
      key: 'plugin:smtp:password',
      pluginId: 'smtp',
      type: 'string',
      isSecret: true,
      label: 'SMTP Password',
      category: 'plugin:smtp',
    });

    app.kernel.configCenter.registerDefinition({
      key: 'system.default_only',
      type: 'string',
      isSecret: false,
      label: 'Default Only',
      category: 'general',
      tags: ['sys'],
      defaultValue: 'Default Value',
    });

    app.kernel.configCenter.registerDefinition({
      key: 'system.no_cat',
      type: 'string',
      isSecret: false,
      label: 'No Category',
      defaultValue: 'No Cat Value',
    });

    // 2. Set values as admin
    const setRes1 = await app.inject({
      method: 'POST',
      url: '/system.site_name',
      headers: asUser({ role: 'admin' }),
      payload: { value: 'Production NineDeploy' },
    });
    expect(setRes1.statusCode).toBe(200);

    const setRes2 = await app.inject({
      method: 'POST',
      url: '/plugin:smtp:password',
      headers: asUser({ role: 'admin' }),
      payload: { value: 'super-secret-pass', isSecret: true },
    });
    expect(setRes2.statusCode).toBe(200);

    // Set custom unindexed secret
    const setResCustomSec = await app.inject({
      method: 'POST',
      url: '/custom.secret_token',
      headers: asUser({ role: 'admin' }),
      payload: { value: 'top-secret-val', isSecret: true },
    });
    expect(setResCustomSec.statusCode).toBe(200);

    // Set custom unindexed config
    const setRes3 = await app.inject({
      method: 'POST',
      url: '/custom.analytics_id',
      headers: asUser({ role: 'admin' }),
      payload: { value: 'UA-12345', tags: ['analytics'] },
    });
    expect(setRes3.statusCode).toBe(200);

    // 3. L-12: the listing is admin-only now. Masking secrets was not enough —
    // the non-secret entries still describe how the whole instance is wired,
    // and a member has no operator role to use them for.
    const memberListRes = await app.inject({
      method: 'GET',
      url: '/',
      headers: asUser({ role: 'member' }),
    });
    expect(memberListRes.statusCode).toBe(403);

    // 4. Admin list with reveal=true
    const adminRevealRes = await app.inject({
      method: 'GET',
      url: '/?reveal=true',
      headers: asUser({ role: 'admin' }),
    });
    expect(adminRevealRes.statusCode).toBe(200);
    const adminEntries = adminRevealRes.json().entries;
    const revealedSmtp = adminEntries.find((e: any) => e.key === 'plugin:smtp:password');
    expect(revealedSmtp.value).toBe('super-secret-pass');

    // 5. Admin list filtered by category
    const filterCatRes = await app.inject({
      method: 'GET',
      url: '/?category=general',
      headers: asUser({ role: 'admin' }),
    });
    expect(filterCatRes.statusCode).toBe(200);
    expect(filterCatRes.json().entries.every((e: any) => e.category === 'general')).toBe(true);

    // 6. Admin list filtered by pluginId
    const filterPluginRes = await app.inject({
      method: 'GET',
      url: '/?pluginId=smtp',
      headers: asUser({ role: 'admin' }),
    });
    expect(filterPluginRes.statusCode).toBe(200);
    expect(filterPluginRes.json().entries.every((e: any) => e.pluginId === 'smtp')).toBe(true);

    // 7. Get specific key
    const getPubRes = await app.inject({
      method: 'GET',
      url: '/system.site_name',
      headers: asUser({ role: 'member' }),
    });
    expect(getPubRes.statusCode).toBe(200);
    expect(getPubRes.json().value).toBe('Production NineDeploy');

    // Get default-only key (not in DB)
    const getDefaultOnlyRes = await app.inject({
      method: 'GET',
      url: '/system.default_only',
      headers: asUser({ role: 'member' }),
    });
    expect(getDefaultOnlyRes.statusCode).toBe(200);
    expect(getDefaultOnlyRes.json().value).toBe('Default Value');
    expect(getDefaultOnlyRes.json().tags).toEqual(['sys']);

    // Get key without category (fallback to 'general')
    const getNoCatRes = await app.inject({
      method: 'GET',
      url: '/system.no_cat',
      headers: asUser({ role: 'member' }),
    });
    expect(getNoCatRes.statusCode).toBe(200);
    expect(getNoCatRes.json().category).toBe('general');
    expect(getNoCatRes.json().tags).toEqual([]);

    // Get secret as member (masked)
    const getSecretMemberRes = await app.inject({
      method: 'GET',
      url: '/plugin:smtp:password',
      headers: asUser({ role: 'member' }),
    });
    expect(getSecretMemberRes.statusCode).toBe(200);
    expect(getSecretMemberRes.json().value).toBe('••••••••');

    // Get custom secret as member (masked)
    const getCustomSecMemberRes = await app.inject({
      method: 'GET',
      url: '/custom.secret_token',
      headers: asUser({ role: 'member' }),
    });
    expect(getCustomSecMemberRes.statusCode).toBe(200);
    expect(getCustomSecMemberRes.json().value).toBe('••••••••');

    // Get secret as admin stays masked unless reveal=true is explicit.
    const getSecretAdminRes = await app.inject({
      method: 'GET',
      url: '/plugin:smtp:password',
      headers: asUser({ role: 'admin' }),
    });
    expect(getSecretAdminRes.statusCode).toBe(200);
    expect(getSecretAdminRes.json().value).toBe('••••••••');

    const getSecretAdminRevealRes = await app.inject({
      method: 'GET',
      url: '/plugin:smtp:password?reveal=true',
      headers: asUser({ role: 'admin' }),
    });
    expect(getSecretAdminRevealRes.statusCode).toBe(200);
    expect(getSecretAdminRevealRes.json().value).toBe('super-secret-pass');

    // 8. 404 on missing key
    const missingRes = await app.inject({
      method: 'GET',
      url: '/nonexistent.key',
      headers: asUser({ role: 'admin' }),
    });
    expect(missingRes.statusCode).toBe(404);

    // 9. Delete key
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/system.site_name',
      headers: asUser({ role: 'admin' }),
    });
    expect(delRes.statusCode).toBe(200);

    // Member cannot mutate config
    const memberSetRes = await app.inject({
      method: 'POST',
      url: '/system.site_name',
      headers: asUser({ role: 'member' }),
      payload: { value: 'Hacked' },
    });
    expect(memberSetRes.statusCode).toBe(403);

    await app.close();
  });

  it('K8: never persists the mask as a secret value, and an omitted value keeps the current one', async () => {
    const store = new Map<string, any>();
    const findEntry = (args: any) => {
      if (!args) return undefined;
      for (const [k, v] of store.entries()) {
        if (args === k || args?.where === k) return v;
        const chunks = args?.where?.queryChunks ?? args?.queryChunks;
        if (Array.isArray(chunks)) {
          for (const chunk of chunks) {
            if (chunk === k || chunk?.value === k || (Array.isArray(chunk?.value) && chunk.value.includes(k))) return v;
          }
        }
        if (args?.where?.value === k || args?.where?.right?.value === k || args?.where?.left?.value === k) return v;
        try {
          if (JSON.stringify(args).includes(k)) return v;
        } catch {}
      }
      return undefined;
    };
    const fakeDb = createFakeDb({
      findFirst: { configEntries: ((args: any) => findEntry(args)) as any },
      findMany: { configEntries: (() => Array.from(store.values())) as any },
      insert: {
        configEntries: ((val: any) => {
          store.set(val.key, val);
          return [val];
        }) as any,
        config_entries: ((val: any) => {
          store.set(val.key, val);
          return [val];
        }) as any,
      },
    });

    const app = await buildTestApp({ db: fakeDb });
    await app.register(configCenterRoutes);
    app.kernel.configCenter.registerDefinition({
      key: 'plugin:smtp:password',
      pluginId: 'smtp',
      type: 'string',
      isSecret: true,
      label: 'SMTP Password',
      category: 'plugin:smtp',
    });

    // Store a real secret.
    const setRes = await app.inject({
      method: 'POST',
      url: '/plugin:smtp:password',
      headers: asUser({ role: 'admin' }),
      payload: { value: 'real-smtp-secret', isSecret: true },
    });
    expect(setRes.statusCode).toBe(200);

    // Saving the displayed mask back must be refused — the old code silently
    // replaced the real credential with '••••••••'.
    const maskRes = await app.inject({
      method: 'POST',
      url: '/plugin:smtp:password',
      headers: asUser({ role: 'admin' }),
      payload: { value: '••••••••', isSecret: true },
    });
    expect(maskRes.statusCode).toBe(400);
    expect(maskRes.json().error.code).toBe('masked_secret_rejected');

    // An omitted value (blank edit in the UI) is a metadata-only update: the
    // stored secret survives untouched.
    const keepRes = await app.inject({
      method: 'POST',
      url: '/plugin:smtp:password',
      headers: asUser({ role: 'admin' }),
      payload: { isSecret: true, description: 'updated description' },
    });
    expect(keepRes.statusCode).toBe(200);
    const revealRes = await app.inject({
      method: 'GET',
      url: '/?reveal=true',
      headers: asUser({ role: 'admin' }),
    });
    const revealed = revealRes.json().entries.find((e: any) => e.key === 'plugin:smtp:password');
    expect(revealed.value).toBe('real-smtp-secret');
    expect(revealed.description).toBe('updated description');

    await app.close();
  });
});
