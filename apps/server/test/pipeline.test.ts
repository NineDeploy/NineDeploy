import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployments, domains, services } from '@ninedeploy/db';
import { logBus } from '../src/engine/logs.js';
import { runDeployment } from '../src/engine/pipeline.js';

const h = vi.hoisted(() => {
  const buildAndRun = vi.fn(async () => ({ runtimeId: 'c-1', port: 3000, healthPath: '/' }));
  const isHealthy = vi.fn(async () => true);
  const stop = vi.fn(async () => undefined);
  const builder = { buildAndRun, isHealthy, stop };
  const checkoutCommit = vi.fn(async () => 'sha-1234567');
  const decrypt = vi.fn((v: string) => `dec:${v}`);
  const connectionString = vi.fn(() => 'postgres://db/app');
  const writeDynamicConfig = vi.fn(async () => undefined);
  const config: { paths: { reposDir: string; logsDir: string; dataDir: string }; wildcardDomain: string } = {
    paths: { reposDir: '', logsDir: '', dataDir: '' },
    wildcardDomain: '',
  };
  const agentOp = vi.fn(async () => ({ exitCode: 0, lines: [] }));
  return { builder, checkoutCommit, decrypt, connectionString, writeDynamicConfig, config, agentOp };
});

vi.mock('../src/config.js', () => ({ config: h.config }));
// The finalize grace period sleeps 2s in real life — stub it for tests.
const execMock = vi.hoisted(() => ({
  sleep: vi.fn(async () => undefined),
  run: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));
const sleepMock = execMock;
vi.mock('../src/lib/exec.js', () => execMock);
vi.mock('../src/lib/crypto.js', () => ({ decrypt: h.decrypt }));
vi.mock('../src/lib/git.js', () => ({ checkoutCommit: h.checkoutCommit }));
vi.mock('../src/lib/agentClient.js', () => ({ agentOp: h.agentOp }));
vi.mock('../src/engine/database.js', () => ({ connectionString: h.connectionString }));
vi.mock('../src/engine/builders/docker.js', () => ({ dockerBuilder: h.builder }));
vi.mock('../src/engine/builders/pm2.js', () => ({ pm2Builder: h.builder }));
vi.mock('../src/engine/proxy.js', () => ({ writeDynamicConfig: h.writeDynamicConfig }));

const base = mkdtempSync(path.join(os.tmpdir(), 'nd-pipeline-'));
const reposDir = path.join(base, 'repos');
const logsDir = path.join(base, 'logs');
mkdirSync(logsDir, { recursive: true });
h.config.paths = { reposDir, logsDir, dataDir: base };

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const dep = {
  id: 1,
  serviceId: 5,
  status: 'queued',
  commitSha: null,
  message: null,
  author: null,
  trigger: 'manual',
  logPath: null,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date(0),
};

const service = {
  id: 5,
  projectId: null,
  name: 'Web',
  slug: 'web',
  type: 'docker',
  status: 'idle',
  repoUrl: 'https://github.com/a/b.git',
  branch: 'main',
  commitSha: null,
  sourceId: null,
  image: null,
  volumeMount: null,
  port: 3000,
  healthPath: '/',
  runtimeId: null,
  cpuShares: 0,
  memLimitMb: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

interface FakeDb {
  query: {
    deployments: { findFirst: ReturnType<typeof vi.fn> };
    services: { findFirst: ReturnType<typeof vi.fn> };
    buildConfigs: { findFirst: ReturnType<typeof vi.fn> };
    sources: { findFirst: ReturnType<typeof vi.fn> };
    envVars: { findMany: ReturnType<typeof vi.fn> };
    databaseAttachments: { findMany: ReturnType<typeof vi.fn> };
    databases: { findFirst: ReturnType<typeof vi.fn> };
    domains: { findFirst: ReturnType<typeof vi.fn> };
  };
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
}

function makeDb(): { db: FakeDb; updates: { table: unknown; values: Record<string, unknown> }[]; inserts: { table: unknown; values: Record<string, unknown> }[] } {
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const db: FakeDb = {
    query: {
      deployments: { findFirst: vi.fn() },
      services: { findFirst: vi.fn() },
      buildConfigs: { findFirst: vi.fn() },
      sources: { findFirst: vi.fn() },
      envVars: { findMany: vi.fn().mockResolvedValue([]) },
      databaseAttachments: { findMany: vi.fn().mockResolvedValue([]) },
      databases: { findFirst: vi.fn().mockResolvedValue(undefined) },
      domains: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return {
          where: vi.fn(() => ({
            // Success-path finalize guard: pretend the row was still `building`.
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          })),
        };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Promise.resolve();
      },
    })),
  };
  return { db, updates, inserts };
}

function collectLogs(id: number): string[] {
  const lines: string[] = [];
  logBus.subscribe(id, (line) => lines.push(line));
  return lines;
}

function baseSetup(db: FakeDb, over: Record<string, unknown> = {}) {
  db.query.deployments.findFirst.mockResolvedValue(dep);
  db.query.services.findFirst.mockResolvedValue({ ...service, ...over });
  db.query.buildConfigs.findFirst.mockResolvedValue(null);
  db.query.envVars.findMany.mockResolvedValue([]);
  db.query.databaseAttachments.findMany.mockResolvedValue([]);
}

describe('runDeployment env merging', () => {
  it('merges project-scope shared env under service env', async () => {
    const { db } = makeDb();
    baseSetup(db, { projectId: 4, image: 'nginx:latest' });
    // Call order: config snapshot (service scope), project scope, service scope.
    let n = 0;
    db.query.envVars.findMany.mockImplementation(async () => {
      n++;
      if (n === 2) return [{ key: 'SHARED', valueEncrypted: 'enc:s', isSecret: true, scope: 'project' }];
      return [{ key: 'OWN', valueEncrypted: 'enc:o', isSecret: true, scope: 'service' }];
    });
    await runDeployment(db as never, 1);
    const ctx = h.builder.buildAndRun.mock.calls.at(-1)![0] as { env: Record<string, string> };
    expect(ctx.env).toEqual({ SHARED: 'dec:enc:s', OWN: 'dec:enc:o' });
  });

  it('skips the project lookup for project-less services', async () => {
    const { db } = makeDb();
    baseSetup(db, { projectId: null, image: 'nginx:latest' });
    await runDeployment(db as never, 1);
    // Snapshot + service lookup only — no project-scope query.
    expect(db.query.envVars.findMany).toHaveBeenCalledTimes(2);
  });

  it('snapshots the effective config onto the deployment row', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { image: 'nginx:latest' });
    await runDeployment(db as never, 1);
    const building = updates.find((u) => u.values.status === 'building');
    expect(building).toBeDefined();
    const snapshot = JSON.parse(building!.values.configSnapshot as string) as Record<string, unknown>;
    expect(snapshot.image).toBe('nginx:latest');
    expect(snapshot.restartPolicy).toBe('unless-stopped');
    expect(snapshot.envKeys).toEqual([]);
  });
});

describe('runDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logBus.removeAllListeners();
    h.config.wildcardDomain = '';
    h.builder.buildAndRun.mockImplementation(async () => ({ runtimeId: 'c-1', port: 3000, healthPath: '/' }));
    h.builder.isHealthy.mockImplementation(async () => true);
    h.builder.stop.mockImplementation(async () => undefined);
    h.checkoutCommit.mockImplementation(async () => 'sha-1234567');
    h.writeDynamicConfig.mockImplementation(async () => undefined);
    h.connectionString.mockImplementation(() => 'postgres://db/app');
  });

  afterEach(() => {
    logBus.removeAllListeners();
  });

  it('returns early when the deployment row is missing', async () => {
    const { db, updates } = makeDb();
    db.query.deployments.findFirst.mockResolvedValue(undefined);

    await runDeployment(db as never, 1);

    expect(db.query.services.findFirst).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(h.checkoutCommit).not.toHaveBeenCalled();
    expect(h.builder.buildAndRun).not.toHaveBeenCalled();
  });

  it('returns early when the service row is missing', async () => {
    const { db, updates } = makeDb();
    db.query.deployments.findFirst.mockResolvedValue(dep);
    db.query.services.findFirst.mockResolvedValue(undefined);

    await runDeployment(db as never, 1);

    expect(updates).toHaveLength(0);
    expect(h.builder.buildAndRun).not.toHaveBeenCalled();
  });

  it('fails the deployment for an unknown service type', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { type: 'k8s' });
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('▶ Deployment #1 for "Web" (k8s)');
    expect(lines).toContain('✗ Unknown service type: k8s');
    expect(updates.map((u) => [u.table, u.values.status])).toEqual([
      [deployments, 'building'],
      [services, 'deploying'],
      [deployments, 'failed'],
      [services, 'error'],
    ]);
    expect(h.builder.buildAndRun).not.toHaveBeenCalled();
  });

  it('deploys an image-based service without touching git', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { image: 'nginx:latest', port: null });
    h.builder.buildAndRun.mockImplementation(async () => ({ runtimeId: 'c-1', port: null, healthPath: '/' }));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(h.checkoutCommit).not.toHaveBeenCalled();
    expect(h.builder.buildAndRun).toHaveBeenCalledTimes(1);
    const [ctx, previous] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(ctx.commitSha).toBe('');
    expect(ctx.workDir).toBe(path.join(reposDir, '5'));
    expect(previous).toBeUndefined();
    expect(lines).toContain('Image deploy from nginx:latest');
    expect(lines).toContain('Running healthcheck …');
    expect(lines).toContain('✓ Deployment successful');

    const svcUpdate = updates.find((u) => u.table === services && u.values.status === 'running');
    expect(svcUpdate?.values).toMatchObject({ runtimeId: 'c-1', port: null, commitSha: '' });
    const depUpdate = updates.find((u) => u.table === deployments && u.values.status === 'running');
    expect(depUpdate?.values.finishedAt).toBeInstanceOf(Date);
    expect(h.writeDynamicConfig).toHaveBeenCalledWith(db);
    expect(db.query.domains.findFirst).not.toHaveBeenCalled();
  });

  it('persists a runtime port repaired during the healthcheck', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { image: 'n8nio/n8n', port: 80 });
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'n8n-1', port: 80, healthPath: '/' });
    h.builder.isHealthy.mockImplementation(async (runtime: { port: number | null }) => {
      runtime.port = 5678;
      return true;
    });

    await runDeployment(db as never, 1);

    const svcUpdate = updates.find((u) => u.table === services && u.values.status === 'running');
    expect(svcUpdate?.values).toMatchObject({ runtimeId: 'n8n-1', port: 5678 });
  });

  it('resolves creds from the source row and persists the checked-out sha', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { sourceId: 7 });
    db.query.deployments.findFirst.mockResolvedValue({ ...dep, commitSha: 'pin-sha' });
    db.query.sources.findFirst.mockResolvedValue({
      id: 7,
      type: 'github',
      tokenEncrypted: 'tok',
      deployKeyEncrypted: 'key',
    });
    h.checkoutCommit.mockResolvedValue('resolved-sha');

    await runDeployment(db as never, 1);

    expect(h.checkoutCommit).toHaveBeenCalledWith(
      'https://github.com/a/b.git',
      'main',
      'pin-sha',
      path.join(reposDir, '5'),
      expect.any(Function),
      { type: 'github', token: 'dec:tok', deployKey: 'dec:key' },
    );
    const shaUpdate = updates.find((u) => u.table === deployments && u.values.commitSha === 'resolved-sha');
    expect(shaUpdate).toBeDefined();
  });

  it('builds creds with undefined token/deployKey when the source has none and defaults the repoUrl', async () => {
    const { db } = makeDb();
    baseSetup(db, { sourceId: 7, repoUrl: null });
    db.query.sources.findFirst.mockResolvedValue({
      id: 7,
      type: 'custom',
      tokenEncrypted: null,
      deployKeyEncrypted: null,
    });

    await runDeployment(db as never, 1);

    expect(h.checkoutCommit).toHaveBeenCalledWith(
      '',
      'main',
      undefined,
      path.join(reposDir, '5'),
      expect.any(Function),
      { type: 'custom', token: undefined, deployKey: undefined },
    );
  });

  it('calls checkoutCommit without creds when the source row is missing', async () => {
    const { db } = makeDb();
    baseSetup(db, { sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue(undefined);

    await runDeployment(db as never, 1);

    expect(db.query.sources.findFirst).toHaveBeenCalled();
    expect(h.checkoutCommit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(String),
      expect.any(Function),
      undefined,
    );
  });

  it('calls checkoutCommit without querying sources when sourceId is absent', async () => {
    const { db } = makeDb();
    baseSetup(db);

    await runDeployment(db as never, 1);

    expect(db.query.sources.findFirst).not.toHaveBeenCalled();
    expect(h.checkoutCommit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(String),
      expect.any(Function),
      undefined,
    );
  });

  it('passes the previous runtime when the service was already running', async () => {
    const { db } = makeDb();
    baseSetup(db, { runtimeId: 'old-c', port: 8080, healthPath: '/health' });

    await runDeployment(db as never, 1);

    const [, previous] = h.builder.buildAndRun.mock.calls[0] as [unknown, unknown];
    expect(previous).toEqual({ runtimeId: 'old-c', port: 8080, healthPath: '/health' });
  });

  it('normalises a null port and healthPath in the previous runtime', async () => {
    const { db } = makeDb();
    baseSetup(db, { runtimeId: 'old-c', port: null, healthPath: null });

    await runDeployment(db as never, 1);

    const [, previous] = h.builder.buildAndRun.mock.calls[0] as [unknown, unknown];
    expect(previous).toEqual({ runtimeId: 'old-c', port: null, healthPath: '/' });
  });

  it('stops the previous runtime after a successful blue-green deploy (finalize)', async () => {
    const { db } = makeDb();
    baseSetup(db, { runtimeId: 'old-c' });
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'c-2', port: 3000, healthPath: '/' });
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('✓ Deployment successful');
    // Routing flipped to the new container first, a grace period let Traefik
    // reload, and only then was the old container stopped.
    expect(h.writeDynamicConfig).toHaveBeenCalledWith(db);
    expect(sleepMock.sleep).toHaveBeenCalledWith(2000);
    expect(h.builder.stop).toHaveBeenCalledWith('old-c', { graceSeconds: undefined });
  });

  it('rolls back to the previous runtime when the new one fails healthcheck (blue-green)', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { runtimeId: 'old-c', port: 8080, healthPath: '/health' });
    // New runtime unhealthy, but the previous is still alive.
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'c-2', port: 8080, healthPath: '/health' });
    h.builder.isHealthy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('↩ Previous runtime is still healthy — rolled back to it.');
    expect(h.builder.stop).toHaveBeenCalledWith('c-2'); // failed new runtime cleaned up
    expect(updates.some((u) => u.table === services && u.values.status === 'running')).toBe(true);
    expect(updates.some((u) => u.table === deployments && u.values.status === 'failed')).toBe(true);
    expect(updates.some((u) => u.table === services && u.values.status === 'error')).toBe(false);
  });

  it('marks the service errored when the previous runtime is gone (PM2-style failure)', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { runtimeId: 'old-c' });
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'c-2', port: 3000, healthPath: '/' });
    // New unhealthy AND the previous is no longer alive.
    h.builder.isHealthy.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await runDeployment(db as never, 1);

    expect(h.builder.stop).toHaveBeenCalledWith('c-2');
    expect(updates.some((u) => u.table === services && u.values.status === 'error')).toBe(true);
    expect(updates.some((u) => u.table === services && u.values.status === 'running')).toBe(false);
  });

  it('treats a previous-runtime probe error as not restorable', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { runtimeId: 'old-c' });
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'c-2', port: 3000, healthPath: '/' });
    h.builder.isHealthy.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('probe boom'));

    await runDeployment(db as never, 1);

    expect(updates.some((u) => u.table === services && u.values.status === 'error')).toBe(true);
  });

  it('does not throw when safeFail cannot persist the failure status', async () => {
    const { db } = makeDb();
    baseSetup(db);
    h.builder.buildAndRun.mockRejectedValue(new Error('build boom'));
    // Make only the failure-status writes inside safeFail reject.
    db.update = vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where:
          values.status === 'failed' || values.status === 'error'
            ? vi.fn().mockRejectedValue(new Error('db locked'))
            : vi.fn().mockResolvedValue(undefined),
      }),
    }));
    const lines = collectLogs(1);

    await expect(runDeployment(db as never, 1)).resolves.toBeUndefined();
    expect(lines).toContain('failed to mark deployment failed: db locked');
    expect(lines).toContain('failed to mark service errored: db locked');
  });

  it('logs a finalize warning and still succeeds when stopping the previous runtime fails', async () => {
    const { db } = makeDb();
    baseSetup(db, { runtimeId: 'old-c' });
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'c-2', port: 3000, healthPath: '/' });
    h.builder.stop.mockRejectedValue(new Error('docker down'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('finalize warning (previous stop): docker down');
    expect(lines).toContain('✓ Deployment successful');
  });

  it('logs a wildcard-domain warning and still succeeds when the insert fails', async () => {
    const { db } = makeDb();
    h.config.wildcardDomain = 'example.com';
    baseSetup(db);
    db.query.domains.findFirst.mockResolvedValue(undefined);
    db.insert = vi.fn(() => ({ values: () => Promise.reject(new Error('unique constraint')) }));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('warning: could not auto-assign wildcard domain: unique constraint');
    expect(lines).toContain('✓ Deployment successful');
  });

  it('auto-provisions a wildcard domain when configured and missing', async () => {
    const { db, inserts } = makeDb();
    h.config.wildcardDomain = 'example.com';
    baseSetup(db);
    db.query.domains.findFirst.mockResolvedValue(undefined);
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(domains);
    expect(inserts[0].values).toEqual({
      serviceId: 5,
      hostname: 'web.example.com',
      path: '/',
      ssl: false,
      status: 'active',
    });
    expect(lines).toContain('🌐 Auto-assigned URL: web.example.com');
  });

  it('does not duplicate an existing wildcard domain', async () => {
    const { db, inserts } = makeDb();
    h.config.wildcardDomain = 'example.com';
    baseSetup(db);
    db.query.domains.findFirst.mockResolvedValue({ id: 1 });
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(inserts).toHaveLength(0);
    expect(lines).not.toContain('🌐 Auto-assigned URL: web.example.com');
  });

  it('logs a proxy warning and still succeeds when the dynamic config write fails', async () => {
    const { db } = makeDb();
    baseSetup(db);
    h.writeDynamicConfig.mockRejectedValue(new Error('disk full'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('proxy warning: disk full');
    expect(lines).toContain('✓ Deployment successful');
  });

  it('logs a proxy warning with the raw value when the failure is not an Error', async () => {
    const { db } = makeDb();
    baseSetup(db);
    h.writeDynamicConfig.mockRejectedValue('disk full');
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('proxy warning: disk full');
    expect(lines).toContain('✓ Deployment successful');
  });

  it('keeps the previous container serving when the routing flip fails (no silent outage)', async () => {
    const { db } = makeDb();
    baseSetup(db, { runtimeId: 'old-c' }); // a previous container is serving
    h.builder.buildAndRun.mockResolvedValue({ runtimeId: 'c-2', port: 3000, healthPath: '/' });
    h.writeDynamicConfig.mockRejectedValue(new Error('disk full'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    // Routing did not flip → the previous container must NOT be retired.
    expect(h.builder.stop).not.toHaveBeenCalledWith('old-c');
    expect(lines).toContain('↩ finalize skipped: routing did not flip, the previous container stays live');
  });

  it('fails the deployment with a stringified reason when the failure is not an Error', async () => {
    const { db } = makeDb();
    baseSetup(db);
    h.builder.buildAndRun.mockRejectedValue('build boom');
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('✗ Deployment failed: build boom');
    expect(h.builder.stop).not.toHaveBeenCalled();
  });

  it('fails the deployment when the healthcheck never passes', async () => {
    const { db, updates } = makeDb();
    baseSetup(db);
    h.builder.isHealthy.mockResolvedValue(false);
    h.builder.stop.mockRejectedValue(new Error('cannot stop'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('✗ Deployment failed: Healthcheck failed — service did not become ready in time');
    expect(h.builder.stop).toHaveBeenCalledWith('c-1');
    expect(updates.some((u) => u.table === deployments && u.values.status === 'failed')).toBe(true);
    expect(updates.some((u) => u.table === services && u.values.status === 'error')).toBe(true);
    expect(updates.some((u) => u.values.status === 'running')).toBe(false);
  });

  it('fails the deployment when buildAndRun throws, without stopping', async () => {
    const { db, updates } = makeDb();
    baseSetup(db);
    h.builder.buildAndRun.mockRejectedValue(new Error('build boom'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('✗ Deployment failed: build boom');
    expect(h.builder.stop).not.toHaveBeenCalled();
    expect(updates.some((u) => u.table === deployments && u.values.status === 'failed')).toBe(true);
  });

  it('fails the deployment when the git checkout throws', async () => {
    const { db } = makeDb();
    baseSetup(db);
    h.checkoutCommit.mockRejectedValue(new Error('auth failed'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines).toContain('✗ Deployment failed: auth failed');
    expect(h.builder.stop).not.toHaveBeenCalled();
  });

  it('loads env vars and connection strings from attached running databases', async () => {
    const { db } = makeDb();
    baseSetup(db);
    db.query.envVars.findMany.mockResolvedValue([
      { id: 1, key: 'FOO', valueEncrypted: 'e1' },
      { id: 2, key: 'BAR', valueEncrypted: 'e2' },
    ]);
    db.query.databaseAttachments.findMany.mockResolvedValue([
      { id: 1, databaseId: 10, envAlias: 'DB_URL' },
      { id: 2, databaseId: 20, envAlias: 'SKIP' },
      { id: 3, databaseId: 30, envAlias: 'GONE' },
    ]);
    db.query.databases.findFirst
      .mockResolvedValueOnce({ id: 10, status: 'running' })
      .mockResolvedValueOnce({ id: 20, status: 'stopped' })
      .mockResolvedValueOnce(undefined);

    await runDeployment(db as never, 1);

    const [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.env).toEqual({ FOO: 'dec:e1', BAR: 'dec:e2', DB_URL: 'postgres://db/app' });
    expect(h.connectionString).toHaveBeenCalledTimes(1);
    expect(h.connectionString).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
    expect(h.decrypt).toHaveBeenCalledWith('e1');
  });

  // ── private-registry auth ────────────────────────────────────────────────
  it('resolves registry auth from a registry-type source for image deploys', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'ghcr.io/acme/app:1', sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({
      id: 7, type: 'registry', registryUsername: 'ci', tokenEncrypted: 'tok-enc',
    });

    await runDeployment(db as never, 1);

    const [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toEqual({ username: 'ci', password: 'dec:tok-enc', server: 'ghcr.io' });
  });

  it('derives no server for bare image names and skips incomplete credentials', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'nginx:latest', sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({
      id: 7, type: 'registry', registryUsername: 'ci', tokenEncrypted: null,
    });
    await runDeployment(db as never, 1);
    let [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toBeUndefined();

    // A non-registry source and a missing source row behave the same.
    h.builder.buildAndRun.mockClear();
    db.query.sources.findFirst.mockResolvedValue({ id: 8, type: 'github', registryUsername: 'ci', tokenEncrypted: 'x' });
    await runDeployment(db as never, 1);
    [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toBeUndefined();

    h.builder.buildAndRun.mockClear();
    db.query.sources.findFirst.mockResolvedValue(undefined);
    await runDeployment(db as never, 1);
    [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toBeUndefined();
  });

  it('skips registry auth for repo deploys even with a registry source', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: null, sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({ id: 7, type: 'registry', registryUsername: 'u', tokenEncrypted: 't' });
    await runDeployment(db as never, 1);
    const [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toBeUndefined();
  });

  it('binds the agent call for services assigned to a remote server', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'nginx:latest', serverId: 4 });
    await runDeployment(db as never, 1);
    const [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(typeof ctx.agentCall).toBe('function');
    // Invoking the bound call routes through agentOp against the remote server.
    const out = await (ctx.agentCall as (op: string, p: Record<string, unknown>, s: (l: string) => void) => Promise<unknown>)(
      'docker.pull', { image: 'nginx' }, () => {},
    );
    expect(out).toEqual({ exitCode: 0, lines: [] });
    expect(h.agentOp).toHaveBeenCalledWith(expect.anything(), 4, 'docker.pull', { image: 'nginx' }, expect.any(Function));
  });

  it('detects registry hosts with a port and skips Docker Hub names', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'registry.local:5000/app:1', sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({ id: 7, type: 'registry', registryUsername: 'u', tokenEncrypted: 't' });
    await runDeployment(db as never, 1);
    const [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toMatchObject({ server: 'registry.local:5000' });

    // org/app (no dot in the first segment) → no server, Docker Hub default.
    h.builder.buildAndRun.mockClear();
    baseSetup(db, { image: 'acme/app:1', sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({ id: 7, type: 'registry', registryUsername: 'u', tokenEncrypted: 't' });
    await runDeployment(db as never, 1);
    const [ctx2] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx2.registryAuth).toMatchObject({ server: undefined });
  });

  it('covers null registryUsername and port-style bare image names', async () => {
    const { db } = makeDb();
    // registryUsername null → username '' → auth skipped (incomplete).
    baseSetup(db, { image: 'reg.io/app:1', sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({ id: 7, type: 'registry', registryUsername: null, tokenEncrypted: 't' });
    await runDeployment(db as never, 1);
    const [ctx] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx.registryAuth).toBeUndefined();

    // A bare name with a single segment: split('/')[0] is the whole name.
    h.builder.buildAndRun.mockClear();
    baseSetup(db, { image: 'app:1', sourceId: 7 });
    db.query.sources.findFirst.mockResolvedValue({ id: 7, type: 'registry', registryUsername: 'u', tokenEncrypted: 't' });
    await runDeployment(db as never, 1);
    const [ctx2] = h.builder.buildAndRun.mock.calls[0] as [Record<string, unknown>];
    expect(ctx2.registryAuth).toMatchObject({ server: undefined });
  });

  // ── cancellation ─────────────────────────────────────────────────────────
  it('aborts before the build when the deployment was cancelled mid-flight', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { image: 'nginx:latest' });
    // First read: the pipeline's initial fetch. Subsequent reads (checkpoints)
    // observe the cancel route's write.
    db.query.deployments.findFirst
      .mockResolvedValueOnce(dep)
      .mockResolvedValue({ ...dep, status: 'cancelled' });
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(h.builder.buildAndRun).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('⏹ Deployment cancelled');
    // No previous runtime → the service is idle, the deployment cancelled.
    const svcUpdate = updates.find((u) => u.table === services && u.values.status === 'idle');
    expect(svcUpdate).toBeTruthy();
    const depUpdate = updates.find((u) => u.table === deployments && u.values.status === 'cancelled');
    expect(depUpdate?.values.finishedAt).toBeInstanceOf(Date);
  });

  it('cancelling with a healthy previous runtime keeps the old version serving', async () => {
    const { db, updates } = makeDb();
    baseSetup(db, { image: 'nginx:latest', runtimeId: 'old-c' });
    // Reads: 1 = initial fetch, 2 = pre-build checkpoint, 3 = post-checkout
    // checkpoint (still in-flight); 4+ = the cancel is visible post-build.
    db.query.deployments.findFirst
      .mockResolvedValueOnce(dep)
      .mockResolvedValueOnce(dep)
      .mockResolvedValueOnce(dep)
      .mockResolvedValue({ ...dep, status: 'cancelled' });
    h.builder.buildAndRun.mockImplementation(async () => ({ runtimeId: 'new-c', port: 3000, healthPath: '/' }));
    h.builder.isHealthy.mockImplementation(async (runtime: { runtimeId: string }) => runtime.runtimeId === 'old-c');
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines.join('\n')).toContain('⏹ Deployment cancelled');
    expect(lines.join('\n')).toContain('↩ Previous runtime is still healthy — rolled back to it.');
    // The new runtime was retired, the service stays running.
    expect(h.builder.stop).toHaveBeenCalledWith('new-c');
    const svcUpdate = updates.find((u) => u.table === services && u.values.status === 'running');
    expect(svcUpdate).toBeTruthy();
  });

  it('a cancel landing just before the finalize write retires the new container', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'nginx:latest', runtimeId: 'old-c' });
    db.query.deployments.findFirst.mockResolvedValue(dep);
    // …but the conditional finalize update (status running + imageDigest set)
    // returns no rows — as if the cancel flipped the row between checkpoint and write.
    const dbAny = db as unknown as {
      update: (t: unknown) => { set: (v: Record<string, unknown>) => { where: () => { returning: () => Promise<unknown[]> } } };
    };
    const origUpdate = dbAny.update.bind(dbAny);
    dbAny.update = ((table: unknown) => {
      const builder = origUpdate(table);
      return {
        set: (values: Record<string, unknown>) => {
          const inner = builder.set(values);
          if (values.status === 'running' && 'imageDigest' in values) {
            return { where: () => ({ returning: () => Promise.resolve([]) }) };
          }
          return inner;
        },
      };
    }) as typeof dbAny.update;
    h.builder.buildAndRun.mockImplementation(async () => ({ runtimeId: 'new-c', port: 3000, healthPath: '/' }));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    const text = lines.join('\n');
    expect(text).toContain('Cancelled just before finalizing');
    expect(h.builder.stop).toHaveBeenCalledWith('new-c');
  });

  it('cancels a repo deploy at the post-checkout checkpoint', async () => {
    const { db } = makeDb();
    baseSetup(db, { repoUrl: 'https://github.com/a/b.git' });
    // Reads: 1 = initial, 2 = pre-build checkpoint; 3 = post-checkout → cancelled.
    db.query.deployments.findFirst
      .mockResolvedValueOnce(dep)
      .mockResolvedValueOnce(dep)
      .mockResolvedValue({ ...dep, status: 'cancelled' });
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(h.checkoutCommit).toHaveBeenCalledTimes(1);
    expect(h.builder.buildAndRun).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('⏹ Deployment cancelled');
  });

  it('cancels after a passing healthcheck, just before the success writes', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'nginx:latest' });
    // Reads: 1 initial, 2 pre-build, 3 post-checkout, 4 post-build; 5 = final checkpoint.
    db.query.deployments.findFirst
      .mockResolvedValueOnce(dep)
      .mockResolvedValueOnce(dep)
      .mockResolvedValueOnce(dep)
      .mockResolvedValueOnce(dep)
      .mockResolvedValue({ ...dep, status: 'cancelled' });
    h.builder.buildAndRun.mockImplementation(async () => ({ runtimeId: 'new-c', port: 3000, healthPath: '/' }));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    // The healthcheck ran; the success path never executed.
    expect(lines.join('\n')).toContain('Running healthcheck');
    expect(lines.join('\n')).toContain('⏹ Deployment cancelled');
    expect(lines.join('\n')).not.toContain('✓ Deployment successful');
  });

  it('a finalize-race cancel without a previous runtime leaves the service untouched', async () => {    const { db } = makeDb();
    baseSetup(db, { image: 'nginx:latest', runtimeId: null });
    db.query.deployments.findFirst.mockResolvedValue(dep);
    const dbAny = db as unknown as {
      update: (t: unknown) => { set: (v: Record<string, unknown>) => { where: () => { returning: () => Promise<unknown[]> } } };
    };
    const origUpdate = dbAny.update.bind(dbAny);
    dbAny.update = ((table: unknown) => {
      const builder = origUpdate(table);
      return {
        set: (values: Record<string, unknown>) => {
          const inner = builder.set(values);
          if (values.status === 'running' && 'imageDigest' in values) {
            return { where: () => ({ returning: () => Promise.resolve([]) }) };
          }
          return inner;
        },
      };
    }) as typeof dbAny.update;
    h.builder.buildAndRun.mockImplementation(async () => ({ runtimeId: 'new-c', port: 3000, healthPath: '/' }));
    // A failing stop must be swallowed by the cancellation cleanup path.
    h.builder.stop.mockRejectedValueOnce(new Error('docker gone'));
    const lines = collectLogs(1);

    await runDeployment(db as never, 1);

    expect(lines.join('\n')).toContain('Cancelled just before finalizing');
    expect(h.builder.stop).toHaveBeenCalledWith('new-c');
  });

  it('executes preDeployCmd, postDeployCmd and preStopCmd hooks during deployment', async () => {
    const { db } = makeDb();
    baseSetup(db, { image: 'nginx:latest', runtimeId: 'old-c' });
    db.query.deployments.findFirst.mockResolvedValue(dep);
    const configRow = {
      id: 1,
      serviceId: 5,
      buildPack: 'auto',
      baseDir: '/',
      installCmd: null,
      buildCmd: null,
      startCmd: null,
      dockerfilePath: null,
      preDeployCmd: 'npm run db:migrate',
      postDeployCmd: 'curl -sSL http://localhost/warmup',
      preStopCmd: 'npm run drain',
      restartPolicy: 'unless-stopped',
      stopGraceSeconds: 5,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    db.query.buildConfigs.findFirst.mockResolvedValue(configRow);

    const lines = collectLogs(1);
    await runDeployment(db as never, 1);

    expect(execMock.run).toHaveBeenCalledWith(
      'npm',
      ['run', 'db:migrate'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execMock.run).toHaveBeenCalledWith(
      'curl',
      ['-sSL', 'http://localhost/warmup'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execMock.run).toHaveBeenCalledWith(
      'npm',
      ['run', 'drain'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(lines.join('\n')).toContain('Running Pre-Deploy Hook: npm run db:migrate');
    expect(lines.join('\n')).toContain('Running Post-Deploy Hook: curl -sSL http://localhost/warmup');
    expect(lines.join('\n')).toContain('Running Pre-Stop Hook: npm run drain');
    // Pre-deploy hook failure causes deploy to fail and rollback
    execMock.run.mockRejectedValueOnce(new Error('migration failed'));
    await runDeployment(db as never, 1);
    expect(lines.join('\n')).toContain('✗ Deployment failed: migration failed');

    // Post-deploy hook failure is logged but does not fail the deploy
    execMock.run.mockResolvedValueOnce({ stdout: '', stderr: '' });
    execMock.run.mockRejectedValueOnce(new Error('warmup timed out'));
    await runDeployment(db as never, 1);
    expect(lines.join('\n')).toContain('warning: post-deploy hook failed: warmup timed out');

    // Pre-stop hook failure is logged as warning during finalize
    execMock.run.mockResolvedValueOnce({ stdout: '', stderr: '' }); // pre-deploy ok
    execMock.run.mockResolvedValueOnce({ stdout: '', stderr: '' }); // post-deploy ok
    execMock.run.mockRejectedValueOnce(new Error('drain failed')); // pre-stop fails
    await runDeployment(db as never, 1);
    expect(lines.join('\n')).toContain('pre-stop warning: drain failed');

    // Whitespace hook command returns early
    configRow.preDeployCmd = '   ';
    await runDeployment(db as never, 1);
  });
});
