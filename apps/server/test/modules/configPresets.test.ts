import { beforeEach, describe, expect, it, } from 'vitest';
import { configPresetsRoutes } from '../../src/modules/configPresets.js';
import { asUser, buildTestApp } from '../helpers.js';

interface CcEntry {
  key: string;
  value: string;
  isSecret?: boolean;
}

interface CcStore {
  entries: Map<string, CcEntry>;
  setCalls: Array<{ key: string; value: unknown; opts?: { userId?: number; pluginId?: string } }>;
  deleteCalls: string[];
}

const ccStores: CcStore[] = [];

function makeConfigCenter() {
  const store: CcStore = {
    entries: new Map<string, CcEntry>(),
    setCalls: [],
    deleteCalls: [],
  };
  ccStores.push(store);
  return {
    async get<T>(key: string, def: T): Promise<T> {
      const row = store.entries.get(key);
      if (!row) return def;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return row.value as unknown as T;
      }
    },
    async set(key: string, value: unknown, opts?: { userId?: number; pluginId?: string }): Promise<void> {
      store.setCalls.push({ key, value, opts });
      store.entries.set(key, {
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        isSecret: false,
      });
    },
    async delete(key: string): Promise<boolean> {
      store.deleteCalls.push(key);
      return store.entries.delete(key);
    },
  };
}

async function newApp() {
  const a = await buildTestApp();
  // `buildTestApp` already decorates `app.kernel` with a real `NineDeployKernel`
  // instance; we swap in a stub `configCenter` rather than re-decorating the
  // symbol (Fastify refuses duplicate `decorate()` calls). The same pattern
  // is used by `domainPresets.test.ts` to register a fake provider on the
  // existing registry.
  Object.assign(a.kernel, { configCenter: makeConfigCenter() });
  await a.register(configPresetsRoutes);
  return { app: a, store: ccStores[ccStores.length - 1]! };
}

beforeEach(() => {
  ccStores.length = 0;
});

describe('Config Presets routes (G-23 PR-A)', () => {
  it('GET / returns an empty list when nothing is registered', async () => {
    const { app } = await newApp();
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ presets: [] });
  });

  it('POST / registers a preset and writes the three config-center entries', async () => {
    const { app, store } = await newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: {
        id: 'cloudflare-prod',
        description: 'Cloudflare production DNS',
        values: {
          'dns_records_provider': 'cloudflare-zone',
          'dns_records_content': '198.51.100.7',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'cloudflare-prod', keyCount: 2 });

    // The three config-center writes happened.
    const setKeys = store.setCalls.map((c) => c.key);
    expect(setKeys).toContain('plugin:config-presets:preset.list');
    expect(setKeys).toContain('plugin:config-presets:preset.cloudflare-prod.values');
    expect(setKeys).toContain('plugin:config-presets:preset.cloudflare-prod.description');

    // The list now contains the new id.
    const list = JSON.parse(store.entries.get('plugin:config-presets:preset.list')!.value) as string[];
    expect(list).toEqual(['cloudflare-prod']);
  });

  it('POST / rejects a duplicate id with a 400', async () => {
    const { app } = await newApp();
    const body = { id: 'dup', values: { a: 1 } };
    await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: body });
    const res = await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/already exists/);
  });

  it('POST / rejects an id with invalid characters', async () => {
    const { app } = await newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { id: 'has space', values: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:id returns the stored values + description', async () => {
    const { app } = await newApp();
    await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { id: 'p1', description: 'first preset', values: { k: 'v', n: 42 } },
    });
    const res = await app.inject({ method: 'GET', url: '/p1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: 'p1',
      description: 'first preset',
      values: { k: 'v', n: 42 },
    });
  });

  it('GET /:id returns 404 when the id is not registered', async () => {
    const { app } = await newApp();
    const res = await app.inject({ method: 'GET', url: '/nope', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /:id/apply writes every value to the configCenter (success path)', async () => {
    const { app, store } = await newApp();
    await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { id: 'p1', values: { 'dns_records_provider': 'cloudflare-zone', 'dns_records_content': '203.0.113.9' } },
    });
    // Reset the setCalls buffer — we only care about the apply's writes.
    store.setCalls = [];
    const res = await app.inject({ method: 'PUT', url: '/p1/apply', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'p1', keyCount: 2 });
    const writtenKeys = store.setCalls.map((c) => c.key).sort();
    expect(writtenKeys).toEqual(['dns_records_content', 'dns_records_provider'].sort());
  });

  it('PUT /:id/apply with override replaces the stored value for that one call only', async () => {
    const { app, store } = await newApp();
    await app.inject({
      method: 'POST',
      url: '/',
      headers: asUser(),
      payload: { id: 'p1', values: { k1: 'original', k2: 2 } },
    });
    store.setCalls = [];
    const res = await app.inject({
      method: 'PUT',
      url: '/p1/apply',
      headers: asUser(),
      payload: { override: { k1: 'one-shot' } },
    });
    expect(res.statusCode).toBe(200);
    const k1 = store.setCalls.find((c) => c.key === 'k1');
    expect(k1?.value).toBe('one-shot');
    const k2 = store.setCalls.find((c) => c.key === 'k2');
    expect(k2?.value).toBe(2);
  });

  it('PUT /:id/apply returns 400 when the plugin is disabled', async () => {
    const { app } = await newApp();
    await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: { id: 'p1', values: { k: 'v' } } });
    // Disable the plugin by writing the config-center key it watches.
    const kernel = (app as unknown as { kernel: { configCenter: ReturnType<typeof makeConfigCenter> } }).kernel;
    await kernel.configCenter.set('plugin:config-presets:enabled', false, { userId: 1, pluginId: 'config-presets' });
    const res = await app.inject({ method: 'PUT', url: '/p1/apply', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/disabled/);
  });

  it('PUT /:id/apply returns 404 when the preset is not registered', async () => {
    const { app } = await newApp();
    const res = await app.inject({ method: 'PUT', url: '/nope/apply', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /:id/apply returns 409 with per-key failures when a write throws', async () => {
    const { app } = await newApp();
    await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: { id: 'p1', values: { good: 1, bad: 2 } } });
    // Replace the configCenter with a stub that throws on `bad`.
    const kernel = (app as unknown as { kernel: { configCenter: { set: (k: string, v: unknown) => Promise<void> } } }).kernel;
    const originalSet = kernel.configCenter.set;
    kernel.configCenter.set = async (key: string) => {
      if (key === 'bad') throw new Error('simulated write failure');
      return originalSet(key, 'ok');
    };
    const res = await app.inject({ method: 'PUT', url: '/p1/apply', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, keyCount: 2, failureCount: 1 });
  });

  it('DELETE /:id unregisters the preset and clears its three entries', async () => {
    const { app, store } = await newApp();
    await app.inject({ method: 'POST', url: '/', headers: asUser(), payload: { id: 'p1', values: { k: 'v' } } });
    const res = await app.inject({ method: 'DELETE', url: '/p1', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'p1' });
    expect(store.deleteCalls).toContain('plugin:config-presets:preset.p1.values');
    expect(store.deleteCalls).toContain('plugin:config-presets:preset.p1.description');
    // The list no longer contains 'p1'.
    const list = JSON.parse(store.entries.get('plugin:config-presets:preset.list')!.value) as string[];
    expect(list).toEqual([]);
  });

  it('DELETE /:id returns 404 when the preset is not registered', async () => {
    const { app } = await newApp();
    const res = await app.inject({ method: 'DELETE', url: '/nope', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('all routes require authentication', async () => {
    const { app } = await newApp();
    const get = await app.inject({ method: 'GET', url: '/' });
    const post = await app.inject({ method: 'POST', url: '/', payload: { id: 'x', values: {} } });
    const put = await app.inject({ method: 'PUT', url: '/x/apply', payload: {} });
    const del = await app.inject({ method: 'DELETE', url: '/x' });
    expect(get.statusCode).toBe(401);
    expect(post.statusCode).toBe(401);
    expect(put.statusCode).toBe(401);
    expect(del.statusCode).toBe(401);
  });
});
