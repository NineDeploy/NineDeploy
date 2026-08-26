import { createHmac } from 'node:crypto';
import { describe, expect, it, } from 'vitest';
import { encrypt } from '../src/lib/crypto.js';
import { hookReceiveRoutes, webhookMgmtRoutes } from '../src/modules/hooks.js';
import { asUser, buildConfigRow, buildTestApp, createFakeDb, depRow, domainRow, svcRow, webhookRow } from './helpers.js';

const SECRET = 'hook-secret';
const hook = (over: Record<string, unknown> = {}) =>
  webhookRow({ id: 1, secretEncrypted: encrypt(SECRET), branch: 'main', ...over });

const sig = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

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
    // Without the rawBody plugin the signature cannot match â†’ 401.
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

  it('drops its own insert when a concurrent duplicate won the race (post-hoc dedup)', async () => {
    // Pre-check sees nothing, the insert lands â€” then the post-hoc guard finds
    // older active deployments for the same commit and deletes ours.
    const mine = depRow({ id: 99, trigger: 'webhook', commitSha: 'deadbeef', status: 'queued' });
    const winner = depRow({ id: 42, trigger: 'webhook', commitSha: 'deadbeef', status: 'running' });
    const olderStill = depRow({ id: 50, trigger: 'webhook', commitSha: 'deadbeef', status: 'running' });
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook() },
        insert: { deployments: [mine] },
        findMany: { deployments: [mine, winner, olderStill] },
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

  it('skips pushes that do not touch any watch path', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook({ watchPaths: 'services/api/**\npackages/**' }) } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      head_commit: { id: 'abc', message: 'docs only' },
      commits: [{ id: 'abc', added: ['docs/readme.md'], modified: [], removed: [] }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: 'skipped', reason: 'watch_paths', patterns: 2 });
  });

  it('skips deploys for [skip ci] / [skip cd] commit markers', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook() } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    for (const marker of ['[skip ci]', '[SKIP CD]', '[skip-cd]']) {
      const payload = pushPayload();
      payload.head_commit.message = `update stuff ${marker}`;
      const body = JSON.stringify(payload);
      const res = await app.inject({
        method: 'POST',
        url: '/1',
        headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: 'skipped', reason: 'skip_marker' });
    }
  });

  it('deploys when a changed file matches a watch path', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook({ watchPaths: 'services/api/**' }) },
        insert: { deployments: [depRow({ id: 9, trigger: 'webhook' })] },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      head_commit: { id: 'abc', message: 'api change' },
      commits: [{ id: 'abc', added: ['services/api/src/x.ts'], modified: [], removed: [] }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deploymentId: 9 });
  });

  it('deploys watch-path webhooks when the payload reports no files', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { webhooks: hook({ watchPaths: 'services/api/**' }) },
        insert: { deployments: [depRow({ id: 10, trigger: 'webhook' })] },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({ ref: 'refs/heads/main', head_commit: { id: 'abc', message: 'm' } });
    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deploymentId: 10 });
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

  it('handles pull request opened and synchronize events by spawning ephemeral preview', async () => {
    const parentService = svcRow({
      id: 1,
      slug: 'my-app',
      name: 'My App',
      repoUrl: 'https://github.com/org/repo.git',
      previewDeploymentsEnabled: true,
      previewAutoDestroyOnClose: true,
      previewDomainPattern: 'pr-{{pr}}-{{slug}}.{{domain}}',
      previewMaxActive: 5,
    });

    let svcLookup = 0;
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            svcLookup++;
            return svcLookup === 1 ? parentService : undefined;
          },
          buildConfigs: buildConfigRow({ serviceId: 1 }),
        },
        findMany: {
          services: [svcRow({ id: 99, previewParentServiceId: 1, isEphemeralPreview: true, runtimeId: 'old-pr-c' })],
          envVars: [{ id: 1, serviceId: 1, key: 'API_KEY', valueEncrypted: 'enc', isSecret: true }],
        },
        insert: {
          services: [svcRow({ id: 10, slug: 'my-app-pr-42', prNumber: 42, isEphemeralPreview: true })],
          buildConfigs: [buildConfigRow({ id: 10, serviceId: 10 })],
          domains: [domainRow({ id: 10, serviceId: 10, hostname: 'pr-42-my-app.localhost' })],
          deployments: [depRow({ id: 15, serviceId: 10, trigger: 'webhook' })],
        },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);

    const body = JSON.stringify({
      action: 'opened',
      number: 42,
      pull_request: {
        number: 42,
        title: 'Add feature',
        head: { ref: 'feature-pr-42', sha: 'sha-42', repo: { clone_url: 'https://github.com/org/repo.git' } },
        user: { login: 'alice' },
        merged: false,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      provider: 'github',
      action: 'preview_deployment_queued',
      prNumber: 42,
      previewServiceId: 10,
      deploymentId: 15,
    });
  });

  it('rejects fork preview builds before parent secrets are copied', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: svcRow({
            id: 1,
            previewDeploymentsEnabled: true,
            repoUrl: 'https://github.com/acme/app.git',
          }),
        },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({
      action: 'opened',
      number: 77,
      pull_request: {
        number: 77,
        title: 'untrusted fork',
        head: { ref: 'steal-secrets', sha: 'bad', repo: { clone_url: 'https://github.com/attacker/app.git' } },
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/1', payload: body,
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(body) },
    });
    expect(res.json()).toEqual({ ok: 'skipped', reason: 'external_pr_repository' });
  });

  it('handles pull request closed events by auto-destroying ephemeral preview container and records', async () => {
    const parentService = svcRow({
      id: 1,
      slug: 'my-app',
      name: 'My App',
      previewDeploymentsEnabled: true,
      previewAutoDestroyOnClose: true,
    });
    const previewService = svcRow({
      id: 10,
      slug: 'my-app-pr-42',
      prNumber: 42,
      isEphemeralPreview: true,
      previewParentServiceId: 1,
      runtimeId: 'nd-svc-my-app-pr-42',
      type: 'docker',
    });

    let serviceCalls = 0;
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            serviceCalls++;
            return serviceCalls === 1 ? parentService : previewService;
          },
        },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);

    const body = JSON.stringify({
      action: 'closed',
      number: 42,
      pull_request: {
        number: 42,
        title: 'Add feature',
        head: { ref: 'feature-pr-42', sha: 'sha-42' },
        user: { login: 'alice' },
        merged: true,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      action: 'preview_destroyed',
      prNumber: 42,
      serviceId: 10,
    });
  });

  it('handles gitlab merge request events and skips when previews are disabled or invalid', async () => {
    const parentService = svcRow({
      id: 1,
      previewDeploymentsEnabled: false,
    });

    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: parentService,
        },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);

    const body = JSON.stringify({
      object_attributes: {
        iid: 12,
        action: 'open',
        source_branch: 'mr-branch',
        last_commit_id: 'mr-sha',
        title: 'GitLab MR',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/1',
      headers: { 'content-type': 'application/json', 'x-gitlab-event': 'Merge Request Hook', 'x-gitlab-token': SECRET },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: 'skipped', reason: 'preview_deployments_disabled' });
  });

  it('ignores invalid PR action payloads', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { webhooks: hook({ serviceId: 1 }) } }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const body = JSON.stringify({ action: 'labeled', pull_request: { number: 1 } });
    const res = await app.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(body) },
      payload: body,
    });
    expect(res.json()).toEqual({ ok: 'ignored', reason: 'not_a_valid_pr' });
  });

  it('returns 404 when parent service is not found', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 99 }),
          services: () => undefined,
        },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const prBody = JSON.stringify({
      action: 'opened', number: 1,
      pull_request: { number: 1, title: 't', head: { ref: 'b', sha: 's' } },
    });
    const res = await app.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(prBody) },
      payload: prBody,
    });
    expect(res.statusCode).toBe(404);
  });

  it('skips PR close when autoDestroy is disabled or preview does not exist', async () => {
    const parentNoDestroy = svcRow({ id: 1, previewDeploymentsEnabled: true, previewAutoDestroyOnClose: false });
    const previewExist = svcRow({ id: 2, previewParentServiceId: 1, prNumber: 1 });
    let c = 0;
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            c++;
            return c === 1 ? parentNoDestroy : previewExist;
          },
        },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const closeBody = JSON.stringify({
      action: 'closed', number: 1,
      pull_request: { number: 1, title: 't', head: { ref: 'b', sha: 's' } },
    });
    const res = await app.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(closeBody) },
      payload: closeBody,
    });
    expect(res.json()).toEqual({ ok: 'skipped', reason: 'auto_destroy_disabled' });

    let c4 = 0;
    const app4 = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            c4++;
            return c4 === 1 ? svcRow({ id: 1, previewDeploymentsEnabled: true, previewAutoDestroyOnClose: true }) : undefined;
          },
        },
      }),
      rawBody: true,
    });
    await app4.register(hookReceiveRoutes);
    const res4 = await app4.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(closeBody) },
      payload: closeBody,
    });
    expect(res4.json()).toEqual({ ok: 'skipped', reason: 'no_preview_found' });
  });

  it('handles PR closed destroying pm2 and compose runtimes or null runtimeId', async () => {
    const closeBody = JSON.stringify({
      action: 'closed', number: 1,
      pull_request: { number: 1, title: 't', head: { ref: 'b', sha: 's' } },
    });
    for (const type of ['pm2', 'compose', 'unknown'] as const) {
      let c = 0;
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            webhooks: hook({ serviceId: 1 }),
            services: () => {
              c++;
              return c === 1
                ? svcRow({ id: 1, previewDeploymentsEnabled: true, previewAutoDestroyOnClose: true })
                : svcRow({ id: 2, previewParentServiceId: 1, prNumber: 1, runtimeId: 'rt-1', type });
            },
          },
        }),
        rawBody: true,
      });
      await app.register(hookReceiveRoutes);
      const res = await app.inject({
        method: 'POST', url: '/1',
        headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(closeBody) },
        payload: closeBody,
      });
      expect(res.json()).toMatchObject({ ok: true, action: 'preview_destroyed' });
    }

    let c9 = 0;
    const app9 = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            c9++;
            return c9 === 1 ? svcRow({ id: 1, previewDeploymentsEnabled: true }) : svcRow({ id: 2, runtimeId: null });
          },
        },
      }),
      rawBody: true,
    });
    await app9.register(hookReceiveRoutes);
    const res9 = await app9.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(closeBody) },
      payload: closeBody,
    });
    expect(res9.json()).toMatchObject({ ok: true, action: 'preview_destroyed' });
  });

  it('handles PR synchronize updating existing preview', async () => {
    let c = 0;
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            c++;
            return c === 1
              ? svcRow({ id: 1, previewDeploymentsEnabled: true, repoUrl: 'https://github.com/org/repo.git' })
              : svcRow({ id: 5, previewParentServiceId: 1, prNumber: 1 });
          },
        },
        insert: { deployments: [depRow({ id: 20 })] },
      }),
      rawBody: true,
    });
    await app.register(hookReceiveRoutes);
    const syncBody = JSON.stringify({
      action: 'synchronize', number: 1,
      pull_request: { number: 1, title: 'sync commit', head: { ref: 'b', sha: 'sha-new', repo: { clone_url: 'https://github.com/org/repo.git' } } },
    });
    const res = await app.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(syncBody) },
      payload: syncBody,
    });
    expect(res.json()).toMatchObject({ ok: true, action: 'preview_deployment_queued', previewServiceId: 5 });
  });

  it('prunes oldest preview when max active cap is reached and handles creation failure', async () => {
    const prBody = JSON.stringify({
      action: 'opened', number: 1,
      pull_request: { number: 1, title: 't', head: { ref: 'b', sha: 's', repo: { clone_url: 'https://github.com/org/repo.git' } } },
    });
    for (const oldest of [
      svcRow({ id: 100, previewParentServiceId: 1, isEphemeralPreview: true, runtimeId: 'old-rt', type: 'pm2' }),
      svcRow({ id: 100, previewParentServiceId: 1, isEphemeralPreview: true, runtimeId: 'old-rt', type: 'compose' }),
      svcRow({ id: 50, runtimeId: null }),
      svcRow({ id: 50, runtimeId: 'c-docker', type: 'docker' }),
    ]) {
      let c = 0;
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            webhooks: hook({ serviceId: 1 }),
            services: () => {
              c++;
              return c === 1 ? svcRow({ id: 1, previewDeploymentsEnabled: true, previewMaxActive: 1, repoUrl: 'https://github.com/org/repo.git' }) : undefined;
            },
          },
          findMany: {
            services: [oldest],
          },
          insert: {
            services: [svcRow({ id: 101, isEphemeralPreview: true, prNumber: 2 })],
            deployments: [depRow({ id: 21 })],
          },
        }),
        rawBody: true,
      });
      await app.register(hookReceiveRoutes);
      const pr2 = JSON.stringify({
        action: 'opened', number: 2,
        pull_request: { number: 2, title: 'pr2', head: { ref: 'b2', sha: '', repo: { clone_url: 'https://github.com/org/repo.git' } } },
      });
      const res = await app.inject({
        method: 'POST', url: '/1',
        headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(pr2) },
        payload: pr2,
      });
      expect(res.json()).toMatchObject({ ok: true, previewServiceId: 101 });
    }

    // Service insert fails -> failed_to_create_preview
    let c8 = 0;
    const app8 = await buildTestApp({
      db: createFakeDb({
        findFirst: {
          webhooks: hook({ serviceId: 1 }),
          services: () => {
            c8++;
            return c8 === 1 ? svcRow({ id: 1, previewDeploymentsEnabled: true, repoUrl: 'https://github.com/org/repo.git' }) : undefined;
          },
        },
        insert: {
          services: [],
        },
      }),
      rawBody: true,
    });
    await app8.register(hookReceiveRoutes);
    const res8 = await app8.inject({
      method: 'POST', url: '/1',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig(prBody) },
      payload: prBody,
    });
    expect(res8.json()).toEqual({ ok: 'error', reason: 'failed_to_create_preview' });
  });
});

describe('webhook management routes', () => {
  it('lists webhooks for a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1 }) }, findMany: { webhooks: [hook({ id: 3 })] } }),
    });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'GET', url: '/1/webhooks', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: 3,
        branch: 'main',
        active: true,
        watchPaths: '',
        sourceId: null,
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

  it('returns 404 when the service is missing', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'POST', url: '/99/webhooks', headers: asUser(), payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Service not found');
  });

  it('deletes a webhook', async () => {
    const app = await buildTestApp({ db: createFakeDb({ findFirst: { services: svcRow({ id: 1 }) } }) });
    await app.register(webhookMgmtRoutes);
    const res = await app.inject({ method: 'DELETE', url: '/1/webhooks/4', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
