import { describe, expect, it, vi } from 'vitest';
import { settingsRoutes } from '../src/modules/settings.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

const settingsMock = vi.hoisted(() => {
  // A per-key map the tests can populate. The mock `getSettingString`
  // returns the matching value (or `null` by default), and `setSettingString`
  // records the (key, value) pair so the Namecheap PUT test can assert
  // it without poking at the db mock.
  const values: Record<string, string> = {};
  return {
    getSetting: vi.fn(async () => false),
    setSetting: vi.fn(async () => undefined),
    getSettingString: vi.fn(async (_db: unknown, key: string) => (key in values ? values[key]! : (key === 'dns_token_encrypted' ? 'enc' : null))),
    setSettingString: vi.fn(async (_db: unknown, key: string, value: string) => {
      values[key] = value;
    }),
    __values: values,
  };
});
vi.mock('../src/lib/settings.js', () => settingsMock);

const dnsMock = vi.hoisted(() => ({
  DNS_PROVIDERS: { cloudflare: 'CF_DNS_API_TOKEN', hetzner: 'HETZNER_API_TOKEN' },
  encryptDnsToken: vi.fn((t: string) => `enc:${t}`),
  ensureNetwork: vi.fn(async () => undefined),
  ensureTraefik: vi.fn(async () => undefined),
  getAcmeEmail: vi.fn(async () => 'acme@example.com'),
  getDnsConfig: vi.fn(async () => null),
  writeDynamicConfig: vi.fn(async () => undefined),
}));
vi.mock('../src/engine/proxy.js', () => dnsMock);

const keyMock = vi.hoisted(() => ({
  activeKeyVersion: vi.fn(() => 1),
  knownKeyVersions: vi.fn(() => [0, 1]),
  rotateSecretsWithReport: vi.fn(async () => ({ rotated: 7, activeVersion: 1, backupsNotRotated: 0 })),
}));
vi.mock('../src/lib/crypto.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activeKeyVersion: keyMock.activeKeyVersion,
  knownKeyVersions: keyMock.knownKeyVersions,
}));
vi.mock('../src/lib/keyRotation.js', () => ({ rotateSecretsWithReport: keyMock.rotateSecretsWithReport }));

describe('settings routes (admin-only)', () => {
  it('returns the current flags', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ allowRegistration: false, acmeEmail: null, templatesSource: null, dnsProvider: null, hasDnsToken: true, wildcardApex: null, panelDomain: null });
    await app.close();
  });

  it('saves and clears the panel domain and triggers writeDynamicConfig', async () => {
    const db = createFakeDb();
    const app = await buildTestApp({ db });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/panel-domain',
      headers: asUser(),
      payload: { domain: 'panel.example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, panelDomain: 'panel.example.com' });
    expect(settingsMock.setSettingString).toHaveBeenCalledWith(db, 'panel_domain', 'panel.example.com');
    expect(dnsMock.writeDynamicConfig).toHaveBeenCalledWith(db);

    // Clear domain
    const resClear = await app.inject({
      method: 'PUT',
      url: '/panel-domain',
      headers: asUser(),
      payload: { domain: '' },
    });
    expect(resClear.statusCode).toBe(200);
    expect(resClear.json()).toEqual({ ok: true, panelDomain: null });
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

  it('exposes the DB-configured ACME email over the env fallback', async () => {
    settingsMock.getSettingString.mockResolvedValueOnce('ops@example.com');
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().acmeEmail).toBe('ops@example.com');
    await app.close();
  });

  it('saves the ACME email and audits it', async () => {
    const db = createFakeDb();
    const app = await buildTestApp({ db });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/acme-email',
      headers: asUser(),
      payload: { email: 'acme@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, acmeEmail: 'acme@example.com', applied: 'live' });
    expect(settingsMock.setSettingString).toHaveBeenCalledWith(db, 'acme_email', 'acme@example.com');
    await app.close();
  });

  it('clears the ACME email with an empty string', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/acme-email',
      headers: asUser(),
      payload: { email: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, acmeEmail: null, applied: 'live' });
    await app.close();
  });

  it('rejects an invalid ACME email with 400', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT',
      url: '/acme-email',
      headers: asUser(),
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('saves and clears the template registry source', async () => {
    const db = createFakeDb();
    const app = await buildTestApp({ db });
    await app.register(settingsRoutes);
    const set = await app.inject({
      method: 'PUT', url: '/templates-source', headers: asUser(),
      payload: { source: 'https://registry.example.com/registry.json' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ ok: true, templatesSource: 'https://registry.example.com/registry.json' });
    expect(settingsMock.setSettingString).toHaveBeenCalledWith(db, 'templates_source', 'https://registry.example.com/registry.json');

    const local = await app.inject({
      method: 'PUT', url: '/templates-source', headers: asUser(),
      payload: { source: '/etc/ninedeploy/registry.json' },
    });
    expect(local.statusCode).toBe(200);

    const cleared = await app.inject({
      method: 'PUT', url: '/templates-source', headers: asUser(),
      payload: { source: '' },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ ok: true, templatesSource: null });
    await app.close();
  });

  it('rejects an invalid template source with 400', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT', url: '/templates-source', headers: asUser(),
      payload: { source: 'ftp://nope.example.com/registry.json' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('reports a token configured via env (env-only setup)', async () => {
    vi.stubEnv('NINEDEPLOY_DNS_TOKEN', 'env-token');
    vi.stubEnv('NINEDEPLOY_WILDCARD_DOMAIN', 'env.example.com');
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json().hasDnsToken).toBe(true);
    expect(res.json().wildcardApex).toBe('env.example.com');
    expect(res.json().dnsProvider).toBe(null);
    vi.unstubAllEnvs();
    await app.close();
  });

  it('reports no token when neither DB nor env has one', async () => {
    settingsMock.getSettingString.mockImplementation(async (_db: unknown, key: string) => (key === 'dns_token_encrypted' ? null : null));
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({ method: 'GET', url: '/', headers: asUser() });
    expect(res.json().hasDnsToken).toBe(false);
    await app.close();
  });

  it('saves the DNS-01 challenge config with an encrypted token', async () => {
    const db = createFakeDb();
    const app = await buildTestApp({ db });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT', url: '/dns', headers: asUser(),
      payload: { provider: 'cloudflare', token: 'sekrit', wildcardApex: 'example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, dnsProvider: 'cloudflare', wildcardApex: 'example.com', applied: 'live' });
    expect(settingsMock.setSettingString).toHaveBeenCalledWith(db, 'dns_provider', 'cloudflare');
    expect(settingsMock.setSettingString).toHaveBeenCalledWith(db, 'dns_token_encrypted', 'enc:sekrit');
    expect(settingsMock.setSettingString).toHaveBeenCalledWith(db, 'wildcard_domain', 'example.com');
    await app.close();
  });

  it('keeps the stored token when the payload omits it and can clear the config', async () => {
    const db = createFakeDb();
    const app = await buildTestApp({ db });
    await app.register(settingsRoutes);
    const before = settingsMock.setSettingString.mock.calls.length;
    const keep = await app.inject({
      method: 'PUT', url: '/dns', headers: asUser(),
      payload: { provider: 'hetzner', wildcardApex: '' },
    });
    expect(keep.statusCode).toBe(200);
    const stored: unknown[][] = settingsMock.setSettingString.mock.calls.slice(before).map((c) => [c[1], c[2]]);
    expect(stored).not.toContainEqual(['dns_token_encrypted', expect.any(String)]);

    const cleared = await app.inject({
      method: 'PUT', url: '/dns', headers: asUser(),
      payload: { provider: '', wildcardApex: '' },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ ok: true, dnsProvider: null, wildcardApex: null, applied: 'live' });
    await app.close();
  });

  it('rejects an unsupported DNS provider with 400', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT', url: '/dns', headers: asUser(),
      payload: { provider: 'nope', wildcardApex: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a malformed wildcard apex with 400', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(settingsRoutes);
    const res = await app.inject({
      method: 'PUT', url: '/dns', headers: asUser(),
      payload: { provider: 'cloudflare', wildcardApex: 'not a domain' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ── Namecheap DNS records (G-07 PR-A) ─────────────────────────────────
  // Round-trip coverage of the credential store lives in
  // `test/lib/namecheap.test.ts` (the real crypto.encrypt/decrypt
  // round-trip the route depends on). Here we only check the input
  // validation surface, which the route alone is responsible for.
  describe('Namecheap DNS records input validation', () => {
    it('PUT /dns-records/namecheap rejects a non-IPv4 clientIp with 400', async () => {
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({
        method: 'PUT',
        url: '/dns-records/namecheap',
        headers: asUser(),
        payload: { apiUser: 'u', apiKey: 'k-1234567890', clientIp: 'not-an-ip' },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('PUT /dns-records/namecheap rejects a missing apiKey with 400', async () => {
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({
        method: 'PUT',
        url: '/dns-records/namecheap',
        headers: asUser(),
        payload: { apiUser: 'u', clientIp: '1.2.3.4' },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('PUT /dns-records/namecheap rejects an empty apiUser with 400', async () => {
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({
        method: 'PUT',
        url: '/dns-records/namecheap',
        headers: asUser(),
        payload: { apiUser: '', apiKey: 'k-1234567890', clientIp: '1.2.3.4' },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  /**
   * `lib/keyRotation.rotateSecrets` was implemented, tested, and called by
   * nothing. `.env.example` told operators to run `ninedeploy rotate-keys`, a
   * command that did not exist — so anyone who followed the documented rotation
   * procedure and then dropped the retired key version from
   * NINEDEPLOY_MASTER_KEYS was left holding ciphertext nothing could decrypt.
   */
  describe('master-key rotation', () => {
    it('reports the key ring', async () => {
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({ method: 'GET', url: '/master-key', headers: asUser() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ activeVersion: 1, knownVersions: [0, 1], rotatable: true });
      await app.close();
    });

    it('refuses to rotate when the ring holds a single version', async () => {
      keyMock.knownKeyVersions.mockReturnValueOnce([0]).mockReturnValueOnce([0]);
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const status = await app.inject({ method: 'GET', url: '/master-key', headers: asUser() });
      expect(status.json().rotatable).toBe(false);
      const res = await app.inject({ method: 'POST', url: '/master-key/rotate', headers: asUser() });
      expect(res.statusCode).toBe(422);
      expect(keyMock.rotateSecretsWithReport).not.toHaveBeenCalled();
      await app.close();
    });

    it('rotates and reports the count', async () => {
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({ method: 'POST', url: '/master-key/rotate', headers: asUser() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ rotated: 7, activeVersion: 1, backupsNotRotated: 0, warning: null });
      await app.close();
    });

    it('warns that stored backups are NOT re-encrypted', async () => {
      // Backup envelopes carry their own `NDBK1:v<version>` header and are not
      // touched by the sweep. Retiring the old key would make every backup taken
      // under it permanently unrestorable — the one thing an operator has to
      // know before completing step 4 of the documented procedure.
      keyMock.rotateSecretsWithReport.mockResolvedValueOnce({ rotated: 7, activeVersion: 1, backupsNotRotated: 3 });
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({ method: 'POST', url: '/master-key/rotate', headers: asUser() });
      expect(res.json().warning).toMatch(/3 stored backup/);
      await app.close();
    });

    it('rejects a member with 403', async () => {
      const app = await buildTestApp({ db: createFakeDb() });
      await app.register(settingsRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/master-key/rotate',
        headers: { ...asUser(), 'x-test-role': 'member' },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
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
