import { describe, expect, it } from 'vitest';
import {
  apiToken,
  attachment,
  backup,
  backupWithDb,
  containerStat,
  createApiToken,
  createAttachment,
  createDatabase,
  createDomain,
  createService,
  createSource,
  createTunnel,
  createWebhook,
  createdApiToken,
  createdWebhook,
  deployment,
  dockerResources,
  domain,
  domainEntry,
  envVar,
  errorResponse,
  hostStat,
  id,
  login,
  managedDatabase,
  metricSeries,
  page,
  pagination,
  publicUser,
  refresh,
  register,
  service,
  serviceType,
  session,
  setLimits,
  setup,
  slug,
  source,
  statsSnapshot,
  template,
  templateSummary,
  tokenPair,
  topologyGraph,
  triggerDeploy,
  tunnelEntry,
  updateService,
  upsertEnvVar,
  volumeEntry,
  webhook,
} from '../src/index.js';

/** Helper: assert a schema accepts an input. */
function ok(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) {
  const result = schema.safeParse(value);
  expect(result.success, `expected ${JSON.stringify(value)} to parse`).toBe(true);
  return result.success ? result.data : null;
}

/** Helper: assert a schema rejects an input. */
function bad(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) {
  const result = schema.safeParse(value);
  expect(result.success, `expected ${JSON.stringify(value)} to be rejected`).toBe(false);
}

describe('common', () => {
  describe('slug', () => {
    it('accepts valid slugs', () => {
      expect(slug.safeParse('my-app').success).toBe(true);
      expect(slug.safeParse('ab').success).toBe(true);
      expect(slug.safeParse('a1').success).toBe(true);
      expect(slug.safeParse('a-b-c').success).toBe(true);
      expect(slug.safeParse('x'.repeat(63)).success).toBe(true);
    });

    it('rejects invalid slugs', () => {
      bad(slug, 'A'); // uppercase
      bad(slug, '_foo'); // leading underscore
      bad(slug, 'foo_'); // trailing underscore
      bad(slug, '-foo'); // leading hyphen
      bad(slug, 'foo-'); // trailing hyphen
      bad(slug, 'x'.repeat(64)); // too long
      bad(slug, 'x'); // too short
      bad(slug, ''); // empty
      bad(slug, 'foo bar'); // space
      bad(slug, 'foo/bar'); // slash
      bad(slug, 42); // wrong type
    });
  });

  describe('id', () => {
    it('accepts positive integers', () => {
      expect(id.safeParse(1).success).toBe(true);
      expect(id.safeParse(999).success).toBe(true);
    });

    it('rejects non-positive or non-integer values', () => {
      bad(id, 0);
      bad(id, -3);
      bad(id, 1.5);
      bad(id, '1');
      bad(id, NaN);
    });
  });

  describe('pagination', () => {
    it('applies defaults', () => {
      const data = ok(pagination, {});
      expect(data).toEqual({ limit: 25 });
    });

    it('accepts explicit limit and cursor with coercion', () => {
      const data = ok(pagination, { limit: '10', cursor: '5' });
      expect(data).toEqual({ limit: 10, cursor: 5 });
    });

    it('rejects limits out of range and bad types', () => {
      bad(pagination, { limit: 0 });
      bad(pagination, { limit: 101 });
      bad(pagination, { limit: 'abc' });
      bad(pagination, { cursor: 0 });
      bad(pagination, { cursor: -1 });
    });
  });

  describe('errorResponse', () => {
    it('accepts a standard error envelope', () => {
      const data = ok(errorResponse, { error: { code: 'not_found', message: 'nope', details: { id: 3 } } });
      expect(data).toEqual({ error: { code: 'not_found', message: 'nope', details: { id: 3 } } });
    });

    it('accepts an envelope without details', () => {
      expect(errorResponse.safeParse({ error: { code: 'x', message: 'y' } }).success).toBe(true);
    });

    it('rejects malformed envelopes', () => {
      bad(errorResponse, {});
      bad(errorResponse, { error: { message: 'no code' } });
      bad(errorResponse, { error: { code: 'x' } });
    });
  });

  describe('page', () => {
    it('wraps an item schema', () => {
      const p = page(id);
      const data = ok(p, { items: [1, 2], nextCursor: 3, total: 2 });
      expect(data).toEqual({ items: [1, 2], nextCursor: 3, total: 2 });
    });

    it('allows a null nextCursor and omits total', () => {
      const data = ok(page(slug), { items: ['ab'], nextCursor: null });
      expect(data).toEqual({ items: ['ab'], nextCursor: null });
    });

    it('rejects invalid pages', () => {
      const p = page(id);
      bad(p, { items: ['not-an-id'], nextCursor: null });
      bad(p, { items: [], nextCursor: 0 });
      bad(p, { items: [], nextCursor: null, total: -1 });
    });
  });
});

describe('auth', () => {
  describe('register', () => {
    it('accepts a full registration', () => {
      const data = ok(register, { email: 'a@b.com', password: '12345678', name: 'Ada' });
      expect(data).toEqual({ email: 'a@b.com', password: '12345678', name: 'Ada' });
    });

    it('accepts registration without a name', () => {
      expect(register.safeParse({ email: 'a@b.com', password: '12345678' }).success).toBe(true);
    });

    it('rejects bad email, short password, or empty name', () => {
      bad(register, { email: 'nope', password: '12345678' });
      bad(register, { email: 'a@b.com', password: 'short' });
      bad(register, { email: 'a@b.com', password: '12345678', name: '' });
      bad(register, { email: 'a@b.com', password: 'x'.repeat(129) });
    });
  });

  it('setup is the same shape as register', () => {
    expect(setup).toBe(register);
  });

  describe('login', () => {
    it('accepts valid credentials', () => {
      expect(login.safeParse({ email: 'a@b.com', password: 'p' }).success).toBe(true);
    });

    it('rejects invalid credentials', () => {
      bad(login, { email: 'a@b.com', password: '' });
      bad(login, { email: 'a@b.com' });
      bad(login, { password: 'p' });
    });
  });

  describe('tokenPair', () => {
    it('accepts a valid pair', () => {
      expect(tokenPair.safeParse({ accessToken: 'a', refreshToken: 'b', expiresIn: 900 }).success).toBe(true);
    });

    it('rejects invalid pairs', () => {
      bad(tokenPair, { accessToken: 'a', refreshToken: 'b', expiresIn: 0 });
      bad(tokenPair, { accessToken: 'a', refreshToken: 'b', expiresIn: 1.5 });
      bad(tokenPair, { accessToken: 'a', refreshToken: 'b' });
    });
  });

  describe('refresh', () => {
    it('accepts a non-empty refresh token', () => {
      expect(refresh.safeParse({ refreshToken: 'tok' }).success).toBe(true);
    });

    it('rejects an empty refresh token', () => {
      bad(refresh, { refreshToken: '' });
    });
  });

  describe('publicUser', () => {
    it('accepts a valid user', () => {
      const data = ok(publicUser, { id: 1, email: 'a@b.com', name: null, role: 'admin' });
      expect(data).toEqual({ id: 1, email: 'a@b.com', name: null, role: 'admin' });
    });

    it('rejects invalid users', () => {
      bad(publicUser, { id: 1, email: 'a@b.com', name: null, role: 'root' });
      bad(publicUser, { id: 1, email: 'a@b.com', name: null });
      bad(publicUser, { id: 1.5, email: 'a@b.com', name: null, role: 'member' });
    });
  });

  describe('session', () => {
    it('accepts a session', () => {
      const data = ok(session, {
        user: { id: 1, email: 'a@b.com', name: 'Ada', role: 'admin' },
        tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 60 },
      });
      expect(data?.tokens.expiresIn).toBe(60);
    });

    it('rejects an invalid session', () => {
      bad(session, { user: { id: 1, email: 'a@b.com', role: 'admin' }, tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 60 } });
    });
  });

  describe('api tokens', () => {
    it('createApiToken accepts a name or empty input', () => {
      expect(createApiToken.safeParse({ name: 'ci' }).success).toBe(true);
      expect(createApiToken.safeParse({}).success).toBe(true);
      bad(createApiToken, { name: '' });
      bad(createApiToken, { name: 'x'.repeat(101) });
    });

    it('apiToken accepts a row with datetime fields', () => {
      const data = ok(apiToken, { id: 1, name: 'ci', lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z' });
      expect(data?.name).toBe('ci');
      bad(apiToken, { id: 1, name: 'ci', lastUsedAt: 'not-a-date', createdAt: '2026-01-01T00:00:00Z' });
    });

    it('createdApiToken accepts the one-time response', () => {
      const data = ok(createdApiToken, { id: 1, name: 'ci', token: 'secret', createdAt: '2026-01-01T00:00:00Z' });
      expect(data?.token).toBe('secret');
      bad(createdApiToken, { id: 1, name: 'ci', createdAt: '2026-01-01T00:00:00Z' });
    });
  });
});

describe('service', () => {
  describe('serviceType', () => {
    it('accepts pm2 and docker only', () => {
      expect(serviceType.safeParse('pm2').success).toBe(true);
      expect(serviceType.safeParse('docker').success).toBe(true);
      bad(serviceType, 'k8s');
    });
  });

  describe('createService', () => {
    it('applies defaults', () => {
      const data = ok(createService, { name: 'Web' });
      expect(data).toMatchObject({ name: 'Web', type: 'docker', branch: 'main', build: { buildPack: 'auto', baseDir: '/' } });
    });

    it('accepts a full input', () => {
      const data = ok(createService, {
        projectId: 1,
        name: 'Web',
        slug: 'web',
        type: 'pm2',
        repoUrl: 'https://github.com/a/b.git',
        branch: 'dev',
        sourceId: 2,
        image: 'node:22',
        volumeMount: '/data',
        cpuShares: 512,
        memLimitMb: 256,
        healthPath: '/health',
        port: 3000,
        build: { buildPack: 'dockerfile', baseDir: '/app', installCmd: 'npm i', buildCmd: 'npm run build', startCmd: 'npm start', dockerfilePath: 'Dockerfile' },
      });
      expect(data?.port).toBe(3000);
      expect(data?.build.buildPack).toBe('dockerfile');
    });

    it('rejects invalid inputs', () => {
      bad(createService, { name: '' });
      bad(createService, { name: 'x'.repeat(101) });
      bad(createService, { name: 'Web', slug: 'INVALID' });
      bad(createService, { name: 'Web', type: 'k8s' });
      bad(createService, { name: 'Web', repoUrl: 'not-a-url' });
      bad(createService, { name: 'Web', branch: '' });
      bad(createService, { name: 'Web', port: 0 });
      bad(createService, { name: 'Web', port: 70000 });
      bad(createService, { name: 'Web', cpuShares: -1 });
      bad(createService, { name: 'Web', cpuShares: 262145 });
      bad(createService, { name: 'Web', memLimitMb: -5 });
    });
  });

  describe('updateService', () => {
    it('accepts partial updates', () => {
      expect(updateService.safeParse({ name: 'Renamed' }).success).toBe(true);
      expect(updateService.safeParse({}).success).toBe(true);
    });

    it('still validates provided fields', () => {
      bad(updateService, { port: 0 });
    });
  });

  describe('service', () => {
    const valid = {
      id: 1,
      projectId: null,
      name: 'Web',
      slug: 'web',
      type: 'docker',
      status: 'running',
      repoUrl: null,
      branch: 'main',
      sourceId: null,
      image: null,
      volumeMount: null,
      commitSha: null,
      runtimeId: 'abc',
      healthPath: '/',
      autoUrl: null,
      port: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    it('accepts a full service row', () => {
      expect(service.safeParse(valid).success).toBe(true);
    });

    it('rejects invalid rows', () => {
      bad(service, { ...valid, status: 'bogus' });
      bad(service, { ...valid, id: 1.5 });
      bad(service, { ...valid, createdAt: 'yesterday' });
      bad(service, { ...valid, type: 'k8s' });
      bad(service, { ...valid, healthPath: undefined });
    });
  });

  describe('sources', () => {
    it('createSource accepts valid inputs', () => {
      const data = ok(createSource, { name: 'gh', type: 'github', token: 't', deployKey: 'k', defaultBranch: 'main' });
      expect(data?.name).toBe('gh');
      expect(createSource.safeParse({ name: 'x', type: 'gitlab' }).success).toBe(true);
      expect(createSource.safeParse({ name: 'x', type: 'gitea' }).success).toBe(true);
      expect(createSource.safeParse({ name: 'x', type: 'custom' }).success).toBe(true);
      bad(createSource, { name: '', type: 'github' });
      bad(createSource, { name: 'x', type: 'bitbucket' });
    });

    it('source accepts a row', () => {
      const data = ok(source, { id: 1, name: 'gh', type: 'github', hasToken: true, hasDeployKey: false, defaultBranch: null, createdAt: '2026-01-01T00:00:00Z' });
      expect(data?.hasToken).toBe(true);
      bad(source, { id: 1, name: 'gh', type: 'github', hasToken: 'yes', hasDeployKey: false, defaultBranch: null, createdAt: '2026-01-01T00:00:00Z' });
    });
  });

  describe('deploys', () => {
    it('triggerDeploy accepts optional commitSha', () => {
      expect(triggerDeploy.safeParse({ commitSha: 'abc' }).success).toBe(true);
      expect(triggerDeploy.safeParse({}).success).toBe(true);
      bad(triggerDeploy, { commitSha: 123 });
    });

    it('deployment accepts a row', () => {
      const data = ok(deployment, {
        id: 1,
        status: 'queued',
        commitSha: null,
        message: null,
        author: null,
        trigger: 'manual',
        startedAt: null,
        finishedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      expect(data?.status).toBe('queued');
      bad(deployment, { ...(data as object), status: 'nope' });
      bad(deployment, { ...(data as object), createdAt: 'x' });
    });
  });

  describe('domains', () => {
    it('createDomain applies defaults', () => {
      const data = ok(createDomain, { hostname: 'app.example.com' });
      expect(data).toEqual({ hostname: 'app.example.com', path: '/', ssl: false });
    });

    it('rejects short hostnames and accepts full input', () => {
      expect(createDomain.safeParse({ hostname: 'a.b.c', path: '/api', ssl: true }).success).toBe(true);
      bad(createDomain, { hostname: 'ab' });
      bad(createDomain, { hostname: 'x'.repeat(254) });
    });

    it('domain accepts a row', () => {
      const data = ok(domain, { id: 1, serviceId: 2, hostname: 'a.example.com', path: '/', ssl: true, status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
      expect(data?.hostname).toBe('a.example.com');
      bad(domain, { ...(data as object), ssl: 'yes' });
    });
  });

  describe('webhooks', () => {
    it('createWebhook accepts optional branch', () => {
      expect(createWebhook.safeParse({ branch: 'main' }).success).toBe(true);
      expect(createWebhook.safeParse({}).success).toBe(true);
      bad(createWebhook, { branch: '' });
    });

    it('webhook accepts a row', () => {
      const data = ok(webhook, { id: 1, branch: 'main', active: true, url: 'https://x', createdAt: '2026-01-01T00:00:00Z' });
      expect(data?.active).toBe(true);
      bad(webhook, { id: 1, branch: 'main', active: true, url: 'https://x', createdAt: 'bad' });
    });

    it('createdWebhook includes a secret', () => {
      const data = ok(createdWebhook, { id: 1, branch: 'main', active: true, url: 'https://x', createdAt: '2026-01-01T00:00:00Z', secret: 's3cr3t' });
      expect(data?.secret).toBe('s3cr3t');
      bad(createdWebhook, { id: 1, branch: 'main', active: true, url: 'https://x', createdAt: '2026-01-01T00:00:00Z' });
    });
  });

  describe('databases', () => {
    it('createDatabase accepts all engines', () => {
      for (const engine of ['postgres', 'mysql', 'redis', 'mongo']) {
        expect(createDatabase.safeParse({ name: 'db', engine }).success).toBe(true);
      }
      expect(createDatabase.safeParse({ name: 'db', engine: 'postgres', version: '16', projectId: 1 }).success).toBe(true);
      bad(createDatabase, { name: '', engine: 'postgres' });
      bad(createDatabase, { name: 'db', engine: 'oracle' });
    });

    it('managedDatabase accepts a row', () => {
      const data = ok(managedDatabase, {
        id: 1, projectId: null, name: 'db', slug: 'db', engine: 'postgres', version: '16',
        status: 'running', host: '127.0.0.1', port: 5432, username: 'u', database: 'd',
        connectionString: 'local-connection-string', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      expect(data?.port).toBe(5432);
      bad(managedDatabase, { ...(data as object), port: '5432' });
    });

    it('attachment accepts a nullable database', () => {
      const data = ok(attachment, { id: 1, databaseId: 2, envAlias: 'DB_URL', database: null });
      expect(data?.envAlias).toBe('DB_URL');
      expect(attachment.safeParse({ id: 1, databaseId: 2, envAlias: 'DB_URL', database: { name: 'db', engine: 'redis', status: 'running' } }).success).toBe(true);
      bad(attachment, { id: 1, databaseId: 2, envAlias: 'DB_URL', database: { name: 'db' } });
    });

    it('createAttachment validates the env alias charset', () => {
      ok(createAttachment, { databaseId: 1 });
      ok(createAttachment, { databaseId: 1, envAlias: 'CACHE_URL' });
      ok(createAttachment, { databaseId: 1, envAlias: '  CACHE_URL  ' });
      bad(createAttachment, { databaseId: 0 });
      bad(createAttachment, { databaseId: 1, envAlias: 'MY ALIAS' });
      bad(createAttachment, { databaseId: 1, envAlias: '' });
    });
  });

  describe('env vars', () => {
    it('upsertEnvVar accepts input', () => {
      expect(upsertEnvVar.safeParse({ key: 'PORT', value: '3000' }).success).toBe(true);
      expect(upsertEnvVar.safeParse({ key: 'TOKEN', value: 'x', isSecret: true }).success).toBe(true);
      bad(upsertEnvVar, { key: '', value: 'x' });
      bad(upsertEnvVar, { key: 'K', value: 'x', isSecret: 'yes' });
      // Charset: keys that would break `docker run --env-file` are rejected;
      // surrounding whitespace is trimmed (env aliases share this rule).
      bad(upsertEnvVar, { key: 'MY VAR', value: 'x' });
      bad(upsertEnvVar, { key: '1BAD', value: 'x' });
      bad(upsertEnvVar, { key: 'A-B', value: 'x' });
      expect(upsertEnvVar.safeParse({ key: '  PORT  ', value: 'x' }).success).toBe(true);
      expect(upsertEnvVar.parse({ key: '  PORT  ', value: 'x' }).key).toBe('PORT');
    });

    it('envVar accepts a row', () => {
      const data = ok(envVar, { id: 1, key: 'PORT', value: '3000', isSecret: false });
      expect(data?.key).toBe('PORT');
      bad(envVar, { id: 1, key: 'PORT', value: '3000', isSecret: 'no' });
    });
  });

  describe('setLimits', () => {
    it('accepts optional fields', () => {
      expect(setLimits.safeParse({}).success).toBe(true);
      expect(setLimits.safeParse({ cpuShares: 1024, memLimitMb: 512 }).success).toBe(true);
      bad(setLimits, { cpuShares: 262145 });
      bad(setLimits, { memLimitMb: -1 });
    });
  });

  describe('stats', () => {
    it('hostStat accepts a row', () => {
      const data = ok(hostStat, { cpuCores: 8, load1: 0.5, memTotalBytes: 1000, memUsedBytes: 200, diskTotalBytes: 5000, diskUsedBytes: 1000 });
      expect(data?.cpuCores).toBe(8);
      bad(hostStat, { cpuCores: 8.5, load1: 0.5, memTotalBytes: 1000, memUsedBytes: 200, diskTotalBytes: 5000, diskUsedBytes: 1000 });
    });

    it('containerStat accepts service/database kinds', () => {
      const base = { name: 'c', kind: 'service', refId: 1, refName: 'web', cpuPct: 1.5, memMb: 10, memLimitMb: 100 };
      expect(containerStat.safeParse(base).success).toBe(true);
      expect(containerStat.safeParse({ ...base, kind: 'database', engine: 'redis' }).success).toBe(true);
      bad(containerStat, { ...base, kind: 'other' });
    });

    it('statsSnapshot accepts null host', () => {
      expect(statsSnapshot.safeParse({ host: null, containers: [] }).success).toBe(true);
      expect(statsSnapshot.safeParse({ host: { cpuCores: 1, load1: 0, memTotalBytes: 1, memUsedBytes: 0, diskTotalBytes: 1, diskUsedBytes: 0 }, containers: [] }).success).toBe(true);
      bad(statsSnapshot, { host: null, containers: [{}] });
    });

    it('metricSeries accepts points', () => {
      expect(metricSeries.safeParse({ kind: 'cpu', points: [{ ts: '2026-01-01T00:00:00Z', value: 5 }] }).success).toBe(true);
      bad(metricSeries, { kind: 'cpu', points: [{ ts: 'x', value: 5 }] });
      bad(metricSeries, { kind: 'cpu', points: [{ ts: '2026-01-01T00:00:00Z', value: 5.5 }] });
    });
  });

  describe('topologyGraph', () => {
    it('accepts a graph', () => {
      const data = ok(topologyGraph, {
        services: [{ id: 1, name: 'web', slug: 'web', type: 'docker', status: 'running' }],
        databases: [{ id: 1, name: 'db', engine: 'postgres', status: 'running' }],
        attachments: [{ id: 1, serviceId: 1, databaseId: 1, envAlias: 'DB' }],
        domains: [{ id: 1, serviceId: 1, hostname: 'a.example.com' }],
      });
      expect(data?.services).toHaveLength(1);
      bad(topologyGraph, { services: [{ id: 1, name: 'web' }], databases: [], attachments: [], domains: [] });
    });
  });

  describe('backups', () => {
    it('backup accepts a row', () => {
      const data = ok(backup, { id: 1, databaseId: 2, status: 'done', sizeBytes: 1024, createdAt: '2026-01-01T00:00:00Z' });
      expect(data?.sizeBytes).toBe(1024);
      bad(backup, { id: 1, databaseId: 2, status: 'done', sizeBytes: 1024, createdAt: 'x' });
    });

    it('backupWithDb extends backup', () => {
      const data = ok(backupWithDb, { id: 1, databaseId: null, status: 'done', sizeBytes: 1, createdAt: '2026-01-01T00:00:00Z', databaseName: null });
      expect(data?.databaseName).toBeNull();
      bad(backupWithDb, { id: 1, databaseId: null, status: 'done', sizeBytes: 1, createdAt: '2026-01-01T00:00:00Z' });
    });
  });

  describe('templates', () => {
    it('templateSummary accepts a row', () => {
      const data = ok(templateSummary, { id: 'nextjs', name: 'Next.js', tagline: 't', category: 'web', emoji: '⚛️', featured: true });
      expect(data?.featured).toBe(true);
      expect(templateSummary.safeParse({ id: 'x', name: 'x', tagline: 'x', category: 'x', emoji: 'x' }).success).toBe(true);
      bad(templateSummary, { id: 'x', name: 'x', tagline: 'x', category: 'x' });
    });

    it('template accepts a full row', () => {
      const data = ok(template, {
        id: 'nextjs', name: 'Next.js', tagline: 't', description: 'd', category: 'web', emoji: '⚛️',
        image: 'img', port: 3000, volumeMount: '/data', env: [{ key: 'K', value: 'V', secret: true }],
        website: 'https://x', featured: true,
      });
      expect(data?.port).toBe(3000);
      expect(template.safeParse({ id: 'x', name: 'x', tagline: 'x', description: 'x', category: 'x', emoji: 'x', image: 'x', port: 3000 }).success).toBe(true);
      bad(template, { id: 'x', name: 'x', tagline: 'x', description: 'x', category: 'x', emoji: 'x', image: 'x', port: '3000' });
    });
  });

  describe('domainEntry', () => {
    it('accepts a row', () => {
      const data = ok(domainEntry, {
        id: 1, hostname: 'a.example.com', path: '/', ssl: false, status: 'active',
        serviceId: 1, serviceName: null, container: null, port: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      expect(data?.hostname).toBe('a.example.com');
      bad(domainEntry, { ...(data as object), port: '3000' });
    });
  });

  describe('volumeEntry', () => {
    it('accepts a row with nullable owner', () => {
      const data = ok(volumeEntry, { name: 'v', sizeBytes: 100, owner: null });
      expect(data?.owner).toBeNull();
      expect(volumeEntry.safeParse({ name: 'v', sizeBytes: 100, owner: { kind: 'database', name: 'db', engine: 'postgres' } }).success).toBe(true);
      bad(volumeEntry, { name: 'v', sizeBytes: 100, owner: { kind: 'x' } });
    });
  });

  describe('dockerResources', () => {
    it('accepts a snapshot', () => {
      const data = ok(dockerResources, {
        network: 'ninedeploy', containers: 2, volumes: 1,
        imagesSummary: { total: '10', active: '5', size: '1GB', reclaimable: '200MB' },
        images: [{ repo: 'node', tag: '22', size: '500MB' }],
      });
      expect(data?.containers).toBe(2);
      bad(dockerResources, { network: 'ninedeploy', containers: 2, volumes: 1, imagesSummary: { total: '10', active: '5', size: '1GB' }, images: [] });
    });
  });

  describe('tunnels', () => {
    it('createTunnel accepts input', () => {
      expect(createTunnel.safeParse({ name: 't', token: 'tok' }).success).toBe(true);
      bad(createTunnel, { name: '', token: 'tok' });
      bad(createTunnel, { name: 't', token: '' });
    });

    it('tunnelEntry accepts a row', () => {
      const data = ok(tunnelEntry, { id: 1, name: 't', slug: 't', status: 'running', containerName: 'c', createdAt: '2026-01-01T00:00:00Z' });
      expect(data?.containerName).toBe('c');
      bad(tunnelEntry, { id: 1, name: 't', slug: 't', status: 'running', containerName: 'c', createdAt: 'x' });
    });
  });
});
