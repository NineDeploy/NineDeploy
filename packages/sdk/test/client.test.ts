import { afterAll, describe, expect, it, vi } from 'vitest';
import { NineDeployError, createClient } from '../src/index.js';

interface RecordedInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface RecordedCall {
  url: string;
  init: RecordedInit;
}

interface FakeResponse {
  status: number;
  /** JSON-serializable body; undefined => empty text. */
  body?: unknown;
}

/** Build a fetch mock that records every call and responds from `respond`. */
function makeFetch(respond: (url: string, init: RecordedInit) => FakeResponse) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: RecordedInit) => {
    // Record the path portion (strip the origin) so assertions can use paths.
    calls.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), init });
    const { status, body } = respond(url, init);
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  });
  return { fetchMock, calls };
}

const ok = (body?: unknown): FakeResponse => ({ status: 200, body });
const err = (status: number, body: unknown): FakeResponse => ({ status, body });

const last = (calls: RecordedCall[]): RecordedCall => {
  const call = calls[calls.length - 1];
  if (!call) throw new Error('expected a recorded call');
  return call;
};

describe('createClient', () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('strips a trailing slash from baseUrl', async () => {
    const { fetchMock, calls } = makeFetch(() => ok({}));
    const client = createClient({ baseUrl: 'http://api.test/', fetch: fetchMock });
    await client.services.list();
    expect(last(calls).url).toBe('/v1/services');
  });

  it('sends an Authorization header when getToken returns a token', async () => {
    const { fetchMock, calls } = makeFetch(() => ok([]));
    const client = createClient({ baseUrl: 'http://api.test', getToken: () => 'tok-123', fetch: fetchMock });
    await client.users.list();
    expect(last(calls).init.headers?.['Authorization']).toBe('Bearer tok-123');
  });

  it('omits the Authorization header when getToken returns undefined or null', async () => {
    for (const getToken of [() => undefined, () => null]) {
      const { fetchMock, calls } = makeFetch(() => ok([]));
      const client = createClient({ baseUrl: 'http://api.test', getToken, fetch: fetchMock });
      await client.users.list();
      expect(last(calls).init.headers?.['Authorization']).toBeUndefined();
    }
  });

  it('omits the Authorization header when getToken is not provided', async () => {
    const { fetchMock, calls } = makeFetch(() => ok([]));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    await client.users.list();
    expect(last(calls).init.headers?.['Authorization']).toBeUndefined();
  });

  it('sets Content-Type application/json when a body is sent', async () => {
    const { fetchMock, calls } = makeFetch(() => ok({ id: 1 }));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    await client.services.create({ name: 'web' });
    expect(last(calls).init.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'web' });
  });

  it('does not set Content-Type on GET requests', async () => {
    const { fetchMock, calls } = makeFetch(() => ok([]));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    await client.services.list();
    expect(last(calls).init.headers?.['Content-Type']).toBeUndefined();
  });

  it('parses an empty response body as an empty object (undefined would crash query functions)', async () => {
    const { fetchMock } = makeFetch(() => ok(undefined));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    await expect(client.health()).resolves.toEqual({});
  });

  it('parses a JSON response body', async () => {
    const { fetchMock } = makeFetch(() => ok({ name: 'ninedeploy', version: '1.0.0' }));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    const about = await client.about.get();
    expect(about).toEqual({ name: 'ninedeploy', version: '1.0.0' });
  });

  it('throws a mapped NineDeployError on a failed GET', async () => {
    const { fetchMock } = makeFetch(() => err(404, { error: { code: 'not_found', message: 'nope' } }));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    const promise = client.services.get(7);
    await expect(promise).rejects.toBeInstanceOf(NineDeployError);
    await expect(promise).rejects.toMatchObject({ status: 404, code: 'not_found', message: 'nope' });
  });

  it('throws a mapped NineDeployError on a failed send with a body', async () => {
    const { fetchMock } = makeFetch(() =>
      err(422, { error: { code: 'invalid', message: 'bad input', details: { field: 'name' } } }),
    );
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    const promise = client.services.create({ name: '' });
    await expect(promise).rejects.toBeInstanceOf(NineDeployError);
    await expect(promise).rejects.toMatchObject({
      status: 422,
      code: 'invalid',
      message: 'bad input',
      details: { field: 'name' },
    });
  });

  it('throws a typed error (not SyntaxError) when the failure body is not JSON', async () => {
    // e.g. an HTML 502 page from a reverse proxy.
    const { fetchMock } = makeFetch(() => err(502, '<html>Bad Gateway</html>'));
    const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    await expect(client.services.list()).rejects.toBeInstanceOf(NineDeployError);
    await expect(client.services.list()).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('502'),
    });
  });

  it('falls back to globalThis.fetch when opts.fetch is omitted', async () => {
    const { fetchMock, calls } = makeFetch(() => ok({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient({ baseUrl: 'http://api.test' });
    await client.health();
    expect(last(calls).url).toBe('/health');
  });

  it('rejects with no_fetch when neither opts.fetch nor globalThis.fetch exists', async () => {
    vi.stubGlobal('fetch', undefined);
    const client = createClient({ baseUrl: 'http://api.test' });
    const promise = client.health();
    await expect(promise).rejects.toBeInstanceOf(NineDeployError);
    await expect(promise).rejects.toMatchObject({
      status: 0,
      code: 'no_fetch',
      message: 'No fetch implementation is available',
    });
  });

  describe('auth', () => {
    it('exercises status, setup, register, login, refresh, me and tokens', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.auth.status();
      expect(last(calls)).toMatchObject({ url: '/v1/auth/status', init: { method: 'GET' } });

      await client.auth.setup({ email: 'a@b.com', password: '12345678' });
      expect(last(calls).url).toBe('/v1/setup');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ email: 'a@b.com', password: '12345678' });

      await client.auth.register({ email: 'a@b.com', password: '12345678' });
      expect(last(calls).url).toBe('/v1/auth/register');
      expect(last(calls).init.method).toBe('POST');

      await client.auth.login({ email: 'a@b.com', password: 'p' });
      expect(last(calls).url).toBe('/v1/auth/login');

      await client.auth.refresh({ refreshToken: 'r' });
      expect(last(calls).url).toBe('/v1/auth/refresh');

      await client.auth.logout();
      expect(last(calls).url).toBe('/v1/auth/logout');
      expect(last(calls).init.method).toBe('POST');

      await client.auth.changePassword({ currentPassword: 'a', newPassword: 'b' });
      expect(last(calls).url).toBe('/v1/auth/password');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ currentPassword: 'a', newPassword: 'b' });

      await client.auth.me();
      expect(last(calls).url).toBe('/v1/auth/me');

      await client.auth.tokens.create({ name: 'ci' });
      expect(last(calls).url).toBe('/v1/auth/tokens');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'ci' });

      await client.auth.tokens.create();
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({});

      await client.auth.tokens.list();
      expect(last(calls).url).toBe('/v1/auth/tokens');
      expect(last(calls).init.method).toBe('GET');

      await client.auth.tokens.remove(3);
      expect(last(calls).url).toBe('/v1/auth/tokens/3');
      expect(last(calls).init.method).toBe('DELETE');
    });
  });

  describe('services', () => {
    it('exercises list, get, create, update, remove, stop, start, restart, logs and importBundle', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.services.list();
      expect(last(calls)).toMatchObject({ url: '/v1/services', init: { method: 'GET' } });

      await client.services.get(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1', init: { method: 'GET' } });

      await client.services.create({ name: 'web', type: 'docker' });
      expect(last(calls).url).toBe('/v1/services');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'web', type: 'docker' });

      await client.services.update(1, { name: 'renamed' });
      expect(last(calls).url).toBe('/v1/services/1');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'renamed' });

      await client.services.remove(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1', init: { method: 'DELETE' } });

      await client.services.stop(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/stop', init: { method: 'POST' } });

      await client.services.start(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/start', init: { method: 'POST' } });

      await client.services.restart(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/restart', init: { method: 'POST' } });

      await client.services.logs(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/logs', init: { method: 'GET' } });

      await client.services.importBundle({ repo: 'https://github.com/a/b.git' });
      expect(last(calls).url).toBe('/v1/services/import');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ repo: 'https://github.com/a/b.git' });
    });

    it('exportUrl returns the export path without fetching', () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      expect(client.services.exportUrl(5)).toBe('/v1/services/5/export');
      expect(calls).toHaveLength(0);
    });
  });

  describe('deploys', () => {
    it('exercises trigger (with and without input), list and rollback', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.deploys.trigger(1);
      expect(last(calls).url).toBe('/v1/services/1/deploys');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({});

      await client.deploys.trigger(1, { commitSha: 'abc' });
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ commitSha: 'abc' });

      await client.deploys.list(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/deploys', init: { method: 'GET' } });

      await client.deploys.rollback(1, 2);
      expect(last(calls).url).toBe('/v1/services/1/deploys/2/rollback');
      expect(last(calls).init.method).toBe('POST');
    });
  });

  describe('domains', () => {
    it('exercises list, create, remove, all and setSsl', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.domains.list(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/domains', init: { method: 'GET' } });

      await client.domains.create(1, { hostname: 'app.example.com' });
      expect(last(calls).url).toBe('/v1/services/1/domains');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ hostname: 'app.example.com' });

      await client.domains.remove(1, 2);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/domains/2', init: { method: 'DELETE' } });

      await client.domains.all();
      expect(last(calls)).toMatchObject({ url: '/v1/domains', init: { method: 'GET' } });

      await client.domains.setSsl(2, true);
      expect(last(calls).url).toBe('/v1/domains/2');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ ssl: true });
    });
  });

  describe('volumes', () => {
    it('exercises list and remove (with URI encoding)', async () => {
      const { fetchMock, calls } = makeFetch(() => ok([]));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.volumes.list();
      expect(last(calls)).toMatchObject({ url: '/v1/volumes', init: { method: 'GET' } });

      await client.volumes.remove('my volume');
      expect(last(calls)).toMatchObject({ url: '/v1/volumes/my%20volume', init: { method: 'DELETE' } });
    });
  });

  describe('system', () => {
    it('exercises resources and pruneImages', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.system.resources();
      expect(last(calls)).toMatchObject({ url: '/v1/system/resources', init: { method: 'GET' } });

      await client.system.pruneImages();
      expect(last(calls)).toMatchObject({ url: '/v1/system/prune-images', init: { method: 'POST' } });
    });

    it('exportUrl returns the export path without fetching', () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      expect(client.system.exportUrl()).toBe('/v1/system/export');
      expect(calls).toHaveLength(0);
    });
  });

  describe('tunnels', () => {
    it('exercises list, create and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.tunnels.list();
      expect(last(calls)).toMatchObject({ url: '/v1/tunnels', init: { method: 'GET' } });

      await client.tunnels.create({ name: 't', token: 'tok' });
      expect(last(calls).url).toBe('/v1/tunnels');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 't', token: 'tok' });

      await client.tunnels.remove(1);
      expect(last(calls)).toMatchObject({ url: '/v1/tunnels/1', init: { method: 'DELETE' } });
    });
  });

  describe('activity', () => {
    it('lists activity', async () => {
      const { fetchMock, calls } = makeFetch(() => ok([]));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await client.activity.list();
      expect(last(calls)).toMatchObject({ url: '/v1/activity', init: { method: 'GET' } });
    });
  });

  describe('users', () => {
    it('exercises list, setRole and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.users.list();
      expect(last(calls)).toMatchObject({ url: '/v1/users', init: { method: 'GET' } });

      await client.users.setRole(1, 'admin');
      expect(last(calls).url).toBe('/v1/users/1/role');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ role: 'admin' });

      await client.users.resetPassword(1, { newPassword: 'fresh-pass-123' });
      expect(last(calls).url).toBe('/v1/users/1/password');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ newPassword: 'fresh-pass-123' });

      await client.users.remove(1);
      expect(last(calls)).toMatchObject({ url: '/v1/users/1', init: { method: 'DELETE' } });
    });
  });

  describe('settings', () => {
    it('reads and toggles the registration flag', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.settings.get();
      expect(last(calls)).toMatchObject({ url: '/v1/settings', init: { method: 'GET' } });

      await client.settings.setAllowRegistration(false);
      expect(last(calls).url).toBe('/v1/settings/allow-registration');
      expect(last(calls).init.method).toBe('PUT');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ enabled: false });
    });
  });

  describe('about', () => {
    it('gets about info', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await client.about.get();
      expect(last(calls)).toMatchObject({ url: '/v1/about', init: { method: 'GET' } });
    });
  });

  describe('settings (acme email)', () => {
    it('saves the ACME email', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await client.settings.setAcmeEmail('ops@example.com');
      expect(last(calls)).toMatchObject({ url: '/v1/settings/acme-email', init: { method: 'PUT' } });
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ email: 'ops@example.com' });
      void fetchMock;
    });
  });

    describe('non-JSON ok responses', () => {
    it('resolves an empty 2xx body to an empty object (never undefined)', async () => {
      const { fetchMock } = makeFetch(() => ok());
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await expect(client.auth.status()).resolves.toEqual({});
    });

    it('surfaces an HTML 200 from a misrouted proxy as a typed error', async () => {
      const { fetchMock } = makeFetch(() => ok('<html>index</html>'));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await expect(client.auth.status()).rejects.toMatchObject({ code: 'invalid_response' });
    });
  });

  describe('alerts', () => {
    it('exercises all alert rule methods', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.alerts.list();
      expect(last(calls)).toMatchObject({ url: '/v1/alerts', init: { method: 'GET' } });

      await client.alerts.create({ name: 'high-cpu', metric: 'cpu', threshold: 80 });
      expect(last(calls).url).toBe('/v1/alerts');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'high-cpu', metric: 'cpu', threshold: 80 });

      await client.alerts.update(3, { enabled: false });
      expect(last(calls).url).toBe('/v1/alerts/3');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ enabled: false });

      await client.alerts.remove(3);
      expect(last(calls)).toMatchObject({ url: '/v1/alerts/3', init: { method: 'DELETE' } });
    });
  });

  describe('notifications', () => {
    it('exercises all channel methods and the log', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.notifications.listChannels();
      expect(last(calls)).toMatchObject({ url: '/v1/notifications/channels', init: { method: 'GET' } });

      await client.notifications.createChannel({ name: 'c', type: 'telegram', target: '@x' });
      expect(last(calls).url).toBe('/v1/notifications/channels');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'c', type: 'telegram', target: '@x' });

      await client.notifications.updateChannel(1, { active: false });
      expect(last(calls).url).toBe('/v1/notifications/channels/1');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ active: false });

      await client.notifications.removeChannel(1);
      expect(last(calls)).toMatchObject({ url: '/v1/notifications/channels/1', init: { method: 'DELETE' } });

      await client.notifications.testChannel(1);
      expect(last(calls)).toMatchObject({ url: '/v1/notifications/channels/1/test', init: { method: 'POST' } });

      await client.notifications.log();
      expect(last(calls)).toMatchObject({ url: '/v1/notifications/log', init: { method: 'GET' } });
    });
  });

  describe('sources', () => {
    it('exercises list, create, update and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.sources.list();
      expect(last(calls)).toMatchObject({ url: '/v1/sources', init: { method: 'GET' } });

      await client.sources.create({ name: 'gh', type: 'github', token: 't' });
      expect(last(calls).url).toBe('/v1/sources');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'gh', type: 'github', token: 't' });

      await client.sources.update(1, { name: 'gh2' });
      expect(last(calls).url).toBe('/v1/sources/1');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'gh2' });

      await client.sources.remove(1);
      expect(last(calls)).toMatchObject({ url: '/v1/sources/1', init: { method: 'DELETE' } });
    });
  });

  describe('webhooks', () => {
    it('exercises list, create (with and without input) and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.webhooks.list(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/webhooks', init: { method: 'GET' } });

      await client.webhooks.create(1);
      expect(last(calls).url).toBe('/v1/services/1/webhooks');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({});

      await client.webhooks.create(1, { branch: 'main' });
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ branch: 'main' });

      await client.webhooks.remove(1, 2);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/webhooks/2', init: { method: 'DELETE' } });
    });
  });

  describe('databases', () => {
    it('exercises list, create, get and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.databases.list();
      expect(last(calls)).toMatchObject({ url: '/v1/databases', init: { method: 'GET' } });

      await client.databases.create({ name: 'db', engine: 'postgres' });
      expect(last(calls).url).toBe('/v1/databases');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ name: 'db', engine: 'postgres' });

      await client.databases.get(1);
      expect(last(calls)).toMatchObject({ url: '/v1/databases/1', init: { method: 'GET' } });

      await client.databases.remove(1);
      expect(last(calls)).toMatchObject({ url: '/v1/databases/1', init: { method: 'DELETE' } });
    });
  });

  describe('attachments', () => {
    it('exercises list, create and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.attachments.list(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/attachments', init: { method: 'GET' } });

      await client.attachments.create(1, { databaseId: 2, envAlias: 'DB_URL' });
      expect(last(calls).url).toBe('/v1/services/1/attachments');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ databaseId: 2, envAlias: 'DB_URL' });

      await client.attachments.remove(1, 2);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/attachments/2', init: { method: 'DELETE' } });
    });
  });

  describe('env', () => {
    it('exercises list, create, update and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.env.list(1);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/env', init: { method: 'GET' } });

      await client.env.create(1, { key: 'PORT', value: '3000' });
      expect(last(calls).url).toBe('/v1/services/1/env');
      expect(last(calls).init.method).toBe('POST');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ key: 'PORT', value: '3000' });

      await client.env.update(1, 2, { key: 'PORT', value: '4000' });
      expect(last(calls).url).toBe('/v1/services/1/env/2');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ key: 'PORT', value: '4000' });

      await client.env.remove(1, 2);
      expect(last(calls)).toMatchObject({ url: '/v1/services/1/env/2', init: { method: 'DELETE' } });
    });
  });

  describe('stats', () => {
    it('exercises snapshot and metrics with and without opts', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.stats.snapshot();
      expect(last(calls)).toMatchObject({ url: '/v1/stats', init: { method: 'GET' } });

      await client.stats.metrics(1);
      expect(last(calls).url).toBe('/v1/services/1/metrics?kind=cpu&minutes=60');

      await client.stats.metrics(1, { kind: 'memory', minutes: 5 });
      expect(last(calls).url).toBe('/v1/services/1/metrics?kind=memory&minutes=5');

      await client.stats.metrics(1, {});
      expect(last(calls).url).toBe('/v1/services/1/metrics?kind=cpu&minutes=60');
    });
  });

  describe('dashboard', () => {
    it('gets the dashboard', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await client.dashboard.get();
      expect(last(calls)).toMatchObject({ url: '/v1/dashboard', init: { method: 'GET' } });
    });
  });

  describe('topology', () => {
    it('gets the topology', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await client.topology.get();
      expect(last(calls)).toMatchObject({ url: '/v1/topology', init: { method: 'GET' } });
    });
  });

  describe('backups', () => {
    it('exercises storage, backupNow, listForDb, restore, list and remove', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.backups.storage(1);
      expect(last(calls)).toMatchObject({ url: '/v1/databases/1/storage', init: { method: 'GET' } });

      await client.backups.backupNow(1);
      expect(last(calls)).toMatchObject({ url: '/v1/databases/1/backups', init: { method: 'POST' } });

      await client.backups.listForDb(1);
      expect(last(calls)).toMatchObject({ url: '/v1/databases/1/backups', init: { method: 'GET' } });

      await client.backups.restore(1, 2);
      expect(last(calls)).toMatchObject({ url: '/v1/databases/1/backups/2/restore', init: { method: 'POST' } });

      await client.backups.list();
      expect(last(calls)).toMatchObject({ url: '/v1/backups', init: { method: 'GET' } });

      await client.backups.remove(3);
      expect(last(calls)).toMatchObject({ url: '/v1/backups/3', init: { method: 'DELETE' } });
    });

    it('downloadUrl returns the download path without fetching', () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      expect(client.backups.downloadUrl(3)).toBe('/v1/backups/3/download');
      expect(calls).toHaveLength(0);
    });
  });

  describe('templates', () => {
    it('exercises list, get and deploy', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.templates.list();
      expect(last(calls)).toMatchObject({ url: '/v1/templates', init: { method: 'GET' } });

      await client.templates.get('nextjs');
      expect(last(calls)).toMatchObject({ url: '/v1/templates/nextjs', init: { method: 'GET' } });

      await client.templates.deploy('nextjs');
      expect(last(calls)).toMatchObject({ url: '/v1/templates/nextjs/deploy', init: { method: 'POST' } });
    });
  });

  describe('limits', () => {
    it('exercises setService and setDatabase', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({}));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });

      await client.limits.setService(1, { cpuShares: 512, memLimitMb: 256 });
      expect(last(calls).url).toBe('/v1/services/1/limits');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ cpuShares: 512, memLimitMb: 256 });

      await client.limits.setDatabase(1, { cpuShares: 256, memLimitMb: 128 });
      expect(last(calls).url).toBe('/v1/databases/1/limits');
      expect(last(calls).init.method).toBe('PATCH');
      expect(JSON.parse(last(calls).init.body ?? '{}')).toEqual({ cpuShares: 256, memLimitMb: 128 });
    });
  });

  describe('health', () => {
    it('hits the health endpoint', async () => {
      const { fetchMock, calls } = makeFetch(() => ok({ status: 'ok' }));
      const client = createClient({ baseUrl: 'http://api.test', fetch: fetchMock });
      await client.health();
      expect(last(calls)).toMatchObject({ url: '/health', init: { method: 'GET' } });
    });
  });
});
