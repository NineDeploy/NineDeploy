import { describe, expect, it, vi, beforeEach } from 'vitest';
import { serverRoutes } from '../src/modules/servers.js';
import { asUser, buildTestApp, createFakeDb } from './helpers.js';

const agentMocks = vi.hoisted(() => ({
  agentPing: vi.fn(async () => undefined),
  generateAgentToken: vi.fn(() => 'raw-agent-token'),
}));
vi.mock('../src/lib/agentClient.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/agentClient.js')>('../src/lib/agentClient.js');
  return { ...actual, agentPing: agentMocks.agentPing, generateAgentToken: agentMocks.generateAgentToken };
});

const cryptoMocks = vi.hoisted(() => ({ encrypt: vi.fn((s: string) => `enc:${s}`), decrypt: vi.fn((s: string) => s.replace('enc:', '')) }));
vi.mock('../src/lib/crypto.js', () => cryptoMocks);

const auditMocks = vi.hoisted(() => ({ audit: vi.fn(async () => undefined) }));
vi.mock('../src/lib/audit.js', () => auditMocks);

const serverRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'edge-1',
  host: '10.0.0.5',
  port: 4600,
  status: 'offline',
  tokenEncrypted: 'enc:raw-agent-token',
  lastSeenAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const appWith = async (fixtures: Record<string, unknown>) => {
  const app = await buildTestApp({ db: createFakeDb(fixtures as never) });
  await app.register(serverRoutes, { prefix: '/servers' });
  return app;
};

describe('servers routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires authentication', async () => {
    const app = await appWith({});
    const res = await app.inject({ method: 'GET', url: '/servers' });
    expect(res.statusCode).toBe(401);
  });

  it('requires admin', async () => {
    const app = await appWith({ findFirst: { users: { id: 2, role: 'member' } } });
    const res = await app.inject({ method: 'GET', url: '/servers', headers: { 'x-test-user': '2', 'x-test-role': 'member' } });
    expect(res.statusCode).toBe(403);
  });

  it('lists servers without tokens', async () => {
    const app = await appWith({ findMany: { servers: [serverRow({ status: 'online', lastSeenAt: new Date(0) })] } });
    const res = await app.inject({ method: 'GET', url: '/servers', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ id: 1, name: 'edge-1', host: '10.0.0.5', status: 'online' });
    expect(Object.keys(res.json()[0])).not.toContain('tokenEncrypted');
  });

  it('registers a server and returns the token exactly once', async () => {
    const app = await appWith({ insert: { servers: [serverRow()] } });
    const res = await app.inject({
      method: 'POST', url: '/servers', headers: asUser(),
      payload: { name: 'edge-1', host: '10.0.0.5' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBe('raw-agent-token');
    expect(body.tokenSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.agentCommand).toContain('NINEDEPLOY_AGENT=1');
    expect(cryptoMocks.encrypt).toHaveBeenCalledWith('raw-agent-token');
  });

  it('validates name and host', async () => {
    const app = await appWith({});
    const noName = await app.inject({ method: 'POST', url: '/servers', headers: asUser(), payload: { host: 'h' } });
    expect(noName.statusCode).toBe(400);
    expect(noName.json().error.code).toBe('validation_error');
    const badHost = await app.inject({ method: 'POST', url: '/servers', headers: asUser(), payload: { name: 'x', host: 'bad host!' } });
    expect(badHost.statusCode).toBe(400);
    expect(badHost.json().error.code).toBe('validation_error');
  });

  it('rejects an out-of-range port, an empty body and a failed insert', async () => {
    const app = await appWith({});
    const badPort = await app.inject({
      method: 'POST', url: '/servers', headers: asUser(),
      payload: { name: 'x', host: 'h', port: 99999 },
    });
    expect(badPort.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: '/servers', headers: asUser() });
    expect(empty.statusCode).toBe(400);
    const failed = await appWith({ insert: { servers: [] } });
    const res = await failed.inject({
      method: 'POST', url: '/servers', headers: asUser(),
      payload: { name: 'x', host: 'h.example' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts host:port and non-Error test failures', async () => {
    const app = await appWith({ insert: { servers: [serverRow()] } });
    const res = await app.inject({
      method: 'POST', url: '/servers', headers: asUser(),
      payload: { name: 'edge', host: 'h.example:4601', port: 4601 },
    });
    expect(res.statusCode).toBe(200);
    // A non-numeric port falls back to the default 4600.
    const app3 = await appWith({ insert: { servers: [serverRow()] } });
    const nanPort = await app3.inject({
      method: 'POST', url: '/servers', headers: asUser(),
      payload: { name: 'edge', host: 'h.example', port: 'abc' },
    });
    expect(nanPort.statusCode).toBe(200);
    // Test failures with non-Error rejections stringify.
    agentMocks.agentPing.mockRejectedValueOnce('plain fail');
    const app2 = await appWith({
      findFirst: { servers: serverRow() },
      update: { servers: [serverRow({ status: 'error' })] },
    });
    const test = await app2.inject({ method: 'POST', url: '/servers/1/test', headers: asUser() });
    expect(test.statusCode).toBe(400);
    expect(test.json().error.message).toContain('plain fail');
  });

  it('deletes a server when no services are hosted or force is true', async () => {
    const app = await appWith({
      findFirst: { servers: serverRow({ id: 1, name: 'edge-host' }) },
      findMany: { services: [{ id: 10, name: 'hosted-api', serverId: 1 }] },
    });

    // Blocked without force
    const resBlocked = await app.inject({ method: 'DELETE', url: '/servers/1', headers: asUser() });
    expect(resBlocked.statusCode).toBe(400);
    expect(resBlocked.json().error.message).toContain('locked');
    expect(resBlocked.json().error.message).toContain('hosted-api');

    // Allowed with force
    const resForce = await app.inject({ method: 'DELETE', url: '/servers/1?force=true', headers: asUser() });
    expect(resForce.statusCode).toBe(200);
    expect(resForce.json()).toEqual({ ok: true });
  });

  it('404s when deleting a missing server', async () => {
    const app = await appWith({ findFirst: { servers: undefined } });
    const res = await app.inject({ method: 'DELETE', url: '/servers/99', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('marks a reachable agent online', async () => {
    const app = await appWith({
      findFirst: { servers: serverRow() },
      update: { servers: [serverRow({ status: 'online' })] },
    });
    const res = await app.inject({ method: 'POST', url: '/servers/1/test', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'online' });
    expect(agentMocks.agentPing).toHaveBeenCalledWith('10.0.0.5', 4600, 'raw-agent-token');
  });

  it('marks an unreachable agent error', async () => {
    agentMocks.agentPing.mockRejectedValueOnce(new Error('timeout'));
    const app = await appWith({
      findFirst: { servers: serverRow() },
      update: { servers: [serverRow({ status: 'error' })] },
    });
    const res = await app.inject({ method: 'POST', url: '/servers/1/test', headers: asUser() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('timeout');
  });

  it('approves a pending server and marks it online', async () => {
    const app = await appWith({
      findFirst: { servers: serverRow({ status: 'pending' }) },
      update: { servers: [serverRow({ status: 'online' })] },
    });
    const res = await app.inject({ method: 'POST', url: '/servers/1/approve', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'online' });
    expect(agentMocks.agentPing).toHaveBeenCalledWith('10.0.0.5', 4600, 'raw-agent-token');
  });

  it('rejects a pending server and removes it', async () => {
    const app = await appWith({
      findFirst: { servers: serverRow({ status: 'pending' }) },
    });
    const res = await app.inject({ method: 'POST', url: '/servers/1/reject', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('404s when approving or rejecting a missing server', async () => {
    const app = await appWith({ findFirst: { servers: undefined } });
    const res1 = await app.inject({ method: 'POST', url: '/servers/99/approve', headers: asUser() });
    expect(res1.statusCode).toBe(404);
    const res2 = await app.inject({ method: 'POST', url: '/servers/99/reject', headers: asUser() });
    expect(res2.statusCode).toBe(404);
  });

  it('allows unauthenticated edge agent announcement to register as pending', async () => {
    const app = await appWith({
      findFirst: { servers: undefined },
      insert: { servers: [serverRow({ id: 5, status: 'pending' })] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/servers/announce',
      payload: {
        name: 'auto-edge-1',
        host: '192.168.1.55',
        port: 4600,
        token: 'a'.repeat(32),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, id: 5, status: 'pending' });
    expect(cryptoMocks.encrypt).toHaveBeenCalledWith('a'.repeat(32));
  });

  it('updates existing server when re-announced', async () => {
    const app = await appWith({
      findFirst: { servers: serverRow({ id: 1, host: '192.168.1.55', port: 4600, status: 'pending' }) },
      update: { servers: [serverRow({ id: 1 })] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/servers/announce',
      payload: {
        name: 'auto-edge-renamed',
        host: '192.168.1.55',
        port: 4600,
        token: 'b'.repeat(32),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, id: 1 });
  });
});
