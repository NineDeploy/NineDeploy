import { describe, expect, it, vi } from 'vitest';
import { settingsRoutes } from '../src/modules/settings.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

const settingsMock = vi.hoisted(() => ({
  getSetting: vi.fn(async () => true),
  setSetting: vi.fn(async () => undefined),
}));
vi.mock('../src/lib/settings.js', () => settingsMock);

describe('settings routes (admin-only)', () => {
  it('returns the current flags', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ allowRegistration: true });
    await app.close();
  });

  it('toggles open registration and audits the change', async () => {
    const db = createFakeDb();
    const app = await buildTestApp({ db });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/allow-registration',
      headers: asUser(),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, allowRegistration: false });
    expect(settingsMock.setSetting).toHaveBeenCalledWith(db, 'allow_registration', false);
    await app.close();
  });

  it('re-enables open registration (audit wording flips)', async () => {
    settingsMock.getSetting.mockResolvedValueOnce(false);
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/allow-registration',
      headers: asUser(),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, allowRegistration: true });
    expect(settingsMock.setSetting).toHaveBeenCalledWith(expect.anything(), 'allow_registration', true);
    await app.close();
  });

  it('rejects a non-boolean payload with 400', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/allow-registration',
      headers: asUser(),
      payload: { enabled: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('rejects a member with 403', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/allow-registration',
      headers: { ...asUser(), 'x-test-role': 'member' },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
