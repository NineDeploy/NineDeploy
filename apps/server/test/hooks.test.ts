import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { encrypt } from '../src/lib/crypto.js';
import { hookReceiveRoutes, webhookMgmtRoutes } from '../src/modules/hooks.js';
import { asUser, buildTestApp, createFakeDb, depRow, svcRow, webhookRow } from './helpers.js';

const SECRET = 'hook-secret';
const hook = (over: Record<string, unknown> = {}) =>
  webhookRow({ id: 1, secretEncrypted: encrypt(SECRET), branch: 'main', ...over });

const sig = (body: string) => 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');

function pushPayload(branch = 'main') {
  return {
    ref: `refs/heads/${branch}`,
    head_commit: { id: 'deadbeef', message: 'fix', author: { username: 'bob' } },
    repository: { clone_url: 'https://github.com/acme/app.git' },
  };
}

describe('webhook receiver', () => {
  it('returns 404 for an unknown webhook', async () => {
    const app = await buildTestApp({ db: createFakeDb(), rawBody: true });
    await app.register(hookReceiveRoutes);
    const res = await app.inject({ method: 'POST', url: '/99', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an inactive webhook', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook({ active: false }) } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const res = await app.inject({ method: 'POST', url: '/1', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('handles a missing raw body', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook() } }),
    });
    await app.register(hookReceiveRoutes);
    const res = await app.inject({ method: 'POST', url: '/1', payload: {} });
    // Without the rawBody plugin the signature cannot match → 401.
    expect(res.statusCode).toBe(401);
  });

  it('rejects a bad signature with 401', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook() } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify(pushPayload());
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=bad' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('answers pings with pong', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook() } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({ zen: 'ok' });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'ping', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: 'pong' });
  });

  it('queues a deployment for a matching github push', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook() },
        insert: { deployments: [depRow({ id: 7, trigger: 'webhook' })] },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify(pushPayload('main'));
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, provider: 'github', deploymentId: 7 });
  });

  it('skips a replayed push whose commit is already deployed (dedup)', async () => {
    const existing = depRow({ id: 42, trigger: 'webhook', commitSha: 'deadbeef', status: 'running' });
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook(), deployments: existing },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify(pushPayload('main')); // head_commit.id = deadbeef
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: 'skipped', reason: 'duplicate', deploymentId: 42 });
  });

  it('queues a push with missing commit metadata', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook() },
        insert: { deployments: [depRow({ id: 7, trigger: 'webhook', commitSha: null })] },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, provider: 'github', deploymentId: 7 });
  });

  it('skips pushes for a different branch', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook() } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify(pushPayload('staging'));
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: 'skipped', reason: 'branch', branch: 'staging' });
  });

  it('ignores non-push events', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook() } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({ action: 'opened' });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'issues', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: 'ignored', reason: 'not_a_push' });
  });

  it('accepts gitlab pushes via header token', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook() },
        insert: { deployments: [depRow({ id: 7, trigger: 'webhook' })] },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      commits: [{ id: 'abc', message: 'm', author: { name: 'bob' } }],
      project: { git_http_url: 'https://gitlab.com/acme/app.git' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-gitlab-event': 'Push Hook', 'x-gitlab-token': SECRET },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, provider: 'gitlab', deploymentId: 7 });
  });
});

describe('webhook management routes', () => {
  it('lists webhooks for a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findMany: { webhooks: [hook({ id: 3 })] } }),
    });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/webhooks', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: 3,
        branch: 'main',
        active: true,
        url: 'http://localhost:3000/v1/hooks/3',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('creates a webhook with the service branch by default', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, branch: 'dev' }) },
        insert: { webhooks: [hook({ id: 4, branch: 'dev' })] },
      }),
    });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/webhooks', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 4, branch: 'dev', secret: expect.any(String) });
  });

  it('creates a webhook with the service branch when no body is sent', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, branch: 'dev' }) },
        insert: { webhooks: [hook({ id: 4, branch: 'dev' })] },
      }),
    });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'POST', url: '/1/webhooks', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 4, branch: 'dev' });
  });

  it('creates a webhook with an explicit branch', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, branch: 'dev' }) },
        insert: { webhooks: [hook({ id: 4, branch: 'prod' })] },
      }),
    });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({
      method: 'POST', url: '/1/webhooks', headers: asUser(), payload: { branch: ' prod ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 4, branch: 'prod' });
  });

  it('returns 401 when the service is missing', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'POST', url: '/99/webhooks', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Service not found');
  });

  it('deletes a webhook', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1/webhooks/4', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
