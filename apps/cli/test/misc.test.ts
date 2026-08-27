import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dbCreate,
  dbList,
  deploysList,
  deploysRollback,
  systemDashboard,
  systemInfo,
  systemUpdateCheck,
  tokenCreate,
  tokenList,
  tplDeploy,
  tplList,
} from '../src/commands/misc.js';

const h = vi.hoisted(() => ({
  prompt: vi.fn(),
}));

vi.mock('../src/prompts.js', () => ({ prompt: h.prompt }));

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.exitCode = 0;
  h.prompt.mockResolvedValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dbList', () => {
  it('prints a notice when there are no databases', async () => {
    const client = { databases: { list: vi.fn().mockResolvedValue([]) } };

    await dbList(client as never);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No databases.'));
  });

  it('tables databases, defaulting a missing port', async () => {
    const client = {
      databases: {
        list: vi.fn().mockResolvedValue([
          { id: 1, name: 'main', engine: 'postgres', status: 'running', port: 5432 },
          { id: 2, name: 'cache', engine: 'redis', status: 'running', port: null },
        ]),
      },
    };

    await dbList(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('main');
    expect(text).toContain('5432');
    expect(text).toContain('—');
  });
});

describe('dbCreate', () => {
  it('requires a name', async () => {
    h.prompt.mockResolvedValueOnce('');

    await dbCreate({ databases: { create: vi.fn() } } as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Name required'));
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['1', 'postgres'],
    ['2', 'mysql'],
    ['3', 'mariadb'],
    ['4', 'redis'],
    ['5', 'mongo'],
    ['6', 'valkey'],
    ['7', 'clickhouse'],
    ['8', 'meilisearch'],
    ['9', 'rabbitmq'],
  ])('creates a %s database from engine choice %s', async (choice, engine) => {
    const create = vi.fn().mockResolvedValue({ id: 9, name: 'db1', connectionString: 'postgres://x' });
    h.prompt.mockResolvedValueOnce('db1').mockResolvedValueOnce(choice);

    await dbCreate({ databases: { create } } as never);

    expect(create).toHaveBeenCalledWith({ name: 'db1', engine });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Database "db1" created'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Connection:'));
  });

  it('falls back to postgres for an unknown engine choice', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1, name: 'db1' });
    h.prompt.mockResolvedValueOnce('db1').mockResolvedValueOnce('99');

    await dbCreate({ databases: { create } } as never);

    expect(create).toHaveBeenCalledWith({ name: 'db1', engine: 'postgres' });
  });

  it('skips the connection string when absent', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1, name: 'db1' });
    h.prompt.mockResolvedValueOnce('db1').mockResolvedValueOnce('1');

    await dbCreate({ databases: { create } } as never);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Connection:'));
  });

  it('reports an Error from the client', async () => {
    const create = vi.fn().mockRejectedValue(new Error('no space'));
    h.prompt.mockResolvedValueOnce('db1').mockResolvedValueOnce('1');

    await dbCreate({ databases: { create } } as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no space'));
    expect(process.exitCode).toBe(1);
  });

  it('reports a non-Error rejection', async () => {
    const create = vi.fn().mockRejectedValue('boom');
    h.prompt.mockResolvedValueOnce('db1').mockResolvedValueOnce('1');

    await dbCreate({ databases: { create } } as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('tplList', () => {
  it('prints a notice when there are no templates', async () => {
    const client = { templates: { list: vi.fn().mockResolvedValue([]) } };

    await tplList(client as never);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No templates.'));
  });

  it('tables templates, marking featured ones', async () => {
    const client = {
      templates: {
        list: vi.fn().mockResolvedValue([
          { emoji: '📦', name: 'nextjs', category: 'web', featured: true },
          { emoji: '🛠', name: 'api', category: 'backend', featured: false },
        ]),
      },
    };

    await tplList(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('nextjs');
    expect(text).toContain('★');
    expect(text).toContain('api');
  });
});

describe('tplDeploy', () => {
  it('requires a template id', async () => {
    await tplDeploy({ templates: { deploy: vi.fn() } } as never, '');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(process.exitCode).toBe(1);
  });

  it('deploys a template and prints the service id', async () => {
    const deploy = vi.fn().mockResolvedValue({ serviceId: 42 });
    const client = { templates: { deploy } };

    await tplDeploy(client as never, 'nextjs');

    expect(deploy).toHaveBeenCalledWith('nextjs');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Service ID: 42'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ninedeploy services logs 42'));
  });

  it('reports a failure', async () => {
    const client = { templates: { deploy: vi.fn().mockRejectedValue(new Error('denied')) } };

    await tplDeploy(client as never, 'nextjs');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('denied'));
  });

  it('reports a non-Error rejection', async () => {
    const client = { templates: { deploy: vi.fn().mockRejectedValue('boom') } };

    await tplDeploy(client as never, 'nextjs');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('deploysList', () => {
  it('requires a numeric service id', async () => {
    await deploysList({ deploys: { list: vi.fn() } } as never, 'abc');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('prints a notice when there are no deployments', async () => {
    const client = { deploys: { list: vi.fn().mockResolvedValue([]) } };

    await deploysList(client as never, '21');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No deployments.'));
  });

  it('tables deployments, truncating commit shas', async () => {
    const list = vi.fn().mockResolvedValue([
      { id: 1, status: 'active', commitSha: 'abcdef123456', trigger: 'git', createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, status: 'failed', commitSha: null, trigger: 'api', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    const client = { deploys: { list } };

    await deploysList(client as never, '21');

    expect(list).toHaveBeenCalledWith(21);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('abcdef1');
    expect(text).toContain('—');
  });
});

describe('deploysRollback', () => {
  it('requires numeric service and deploy ids', async () => {
    await deploysRollback({ deploys: { rollback: vi.fn() } } as never, 'abc', '1');
    await deploysRollback({ deploys: { rollback: vi.fn() } } as never, '21', '0');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(process.exitCode).toBe(1);
  });

  it('queues a rollback', async () => {
    const rollback = vi.fn().mockResolvedValue({ deploymentId: 88 });
    const client = { deploys: { rollback } };

    await deploysRollback(client as never, '21', '99');

    expect(rollback).toHaveBeenCalledWith(21, 99);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Rollback to #99 queued'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('#88'));
  });

  it('reports a failure', async () => {
    const client = { deploys: { rollback: vi.fn().mockRejectedValue(new Error('conflict')) } };

    await deploysRollback(client as never, '21', '99');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('conflict'));
  });

  it('reports a non-Error rejection', async () => {
    const client = { deploys: { rollback: vi.fn().mockRejectedValue('boom') } };

    await deploysRollback(client as never, '21', '99');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('tokenCreate', () => {
  it('creates a token with a default name and prints it', async () => {
    const create = vi.fn().mockResolvedValue({ token: 'raw-token', scopes: ['write'] });
    const client = { auth: { tokens: { create } } };
    // Name prompt, then the scope prompt added when token scopes became
    // enforced (an unscoped token carries its owner's full authority).
    h.prompt.mockResolvedValueOnce('ci').mockResolvedValueOnce('write');

    await tokenCreate(client as never);

    expect(h.prompt).toHaveBeenCalledWith('Token name', 'ci');
    expect(create).toHaveBeenCalledWith({ name: 'ci', scopes: ['write'] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('raw-token'));
  });

  it('names an unscoped token as unrestricted rather than showing nothing', async () => {
    const create = vi.fn().mockResolvedValue({ token: 'raw-token', scopes: [] });
    const client = { auth: { tokens: { create } } };
    h.prompt.mockResolvedValueOnce('legacy').mockResolvedValueOnce('');

    await tokenCreate(client as never);

    expect(create).toHaveBeenCalledWith({ name: 'legacy', scopes: [] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('unrestricted (legacy)'));
  });

  it('reports a failure', async () => {
    const client = { auth: { tokens: { create: vi.fn().mockRejectedValue(new Error('denied')) } } };

    await tokenCreate(client as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('denied'));
  });

  it('reports a non-Error rejection', async () => {
    const client = { auth: { tokens: { create: vi.fn().mockRejectedValue('boom') } } };

    await tokenCreate(client as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('tokenList', () => {
  it('prints a notice when there are no tokens', async () => {
    const client = { auth: { tokens: { list: vi.fn().mockResolvedValue([]) } } };

    await tokenList(client as never);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No tokens.'));
  });

  it('tables tokens with formatted dates', async () => {
    const list = vi.fn().mockResolvedValue([
      { id: 1, name: 'ci', lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'deploy', lastUsedAt: '2026-02-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    const client = { auth: { tokens: { list } } };

    await tokenList(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('never');
    expect(text).toContain('deploy');
  });
});

describe('systemInfo', () => {
  it('prints version, license, stats, and tech stack', async () => {
    const get = vi.fn().mockResolvedValue({
      version: '1.2.3',
      license: 'MIT',
      stats: { services: 3, databases: 2, deployments: 7, users: 1 },
      repo: 'https://github.com/acme/ninedeploy',
      techStack: [
        { category: 'Runtime', items: ['node 24'] },
        { category: 'DB', items: ['postgres'] },
      ],
    });
    const client = { about: { get } };

    await systemInfo(client as never);

    expect(get).toHaveBeenCalledOnce();
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('v1.2.3');
    expect(text).toContain('MIT');
    expect(text).toContain('node 24');
  });

  it('prints dashes when the feed omits instance counts (unauthenticated shape)', async () => {
    const get = vi.fn().mockResolvedValue({
      version: '1.2.3', license: 'MIT', repo: 'https://github.com/acme/ninedeploy', techStack: [],
    });
    await systemInfo({ about: { get } } as never);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('Services');
    // The four optional stats all fall back to the em dash.
    expect((text.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('systemDashboard', () => {
  it('reports all systems operational when healthy', async () => {
    const get = vi.fn().mockResolvedValue({
      stats: { running: 2, services: 3, dbRunning: 1, databases: 2, containers: 4, domains: 5, webhooks: 6, deployments: 7 },
      health: [{ serviceId: 1, name: 'api', healthy: true, status: 'running', responseMs: 12, type: 'docker' }],
      recentDeploys: [{ id: 9, serviceName: 'api', status: 'active', createdAt: '2026-01-01T00:00:00Z' }],
    });
    const client = { dashboard: { get } };

    await systemDashboard(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('All systems operational');
    expect(text).toContain('2 running / 3 total');
    expect(text).toContain('12ms');
  });

  it('flags unhealthy running services and empty sections', async () => {
    const get = vi.fn().mockResolvedValue({
      stats: { running: 1, services: 2, dbRunning: 0, databases: 1, containers: 0, domains: 0, webhooks: 0, deployments: 0 },
      health: [
        { serviceId: 1, name: 'api', healthy: true, status: 'running', responseMs: null, type: 'docker' },
        { serviceId: 2, name: 'db', healthy: false, status: 'running', responseMs: 0, type: 'docker' },
        { serviceId: 3, name: 'web', healthy: false, status: 'stopped', responseMs: 5, type: 'git' },
      ],
      recentDeploys: [],
    });
    const client = { dashboard: { get } };

    await systemDashboard(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('Some services need attention');
    expect(text).toContain('No deployments.');
  });

  it('prints a notice when there are no services', async () => {
    const get = vi.fn().mockResolvedValue({
      stats: { running: 0, services: 0, dbRunning: 0, databases: 0, containers: 0, domains: 0, webhooks: 0, deployments: 0 },
      health: [],
      recentDeploys: [],
    });
    const client = { dashboard: { get } };

    await systemDashboard(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('No services.');
  });

  it('prints a notice when there are no recent deploys', async () => {
    const get = vi.fn().mockResolvedValue({
      stats: { running: 0, services: 0, dbRunning: 0, databases: 0, containers: 0, domains: 0, webhooks: 0, deployments: 0 },
      health: [{ serviceId: 1, name: 'api', healthy: true, status: 'running', responseMs: null, type: 'docker' }],
      recentDeploys: [],
    });
    const client = { dashboard: { get } };

    await systemDashboard(client as never);

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('No deployments.');
  });
});

describe('systemUpdateCheck', () => {
  it('announces an available update with its notes URL', async () => {
    const updateCheck = vi.fn().mockResolvedValue({
      current: '0.1.0', latest: '0.2.0', updateAvailable: true,
      notesUrl: 'https://github.com/ninedeploy/ninedeploy/releases/tag/v0.2.0',
      checkedAt: '2026-08-15T00:00:00Z',
    });
    await systemUpdateCheck({ system: { updateCheck } } as never, true);
    expect(updateCheck).toHaveBeenCalledWith(true);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('A new release is available');
    expect(text).toContain('releases/tag/v0.2.0');
  });

  it('links to the tag page when the feed gave no notes URL', async () => {
    const updateCheck = vi.fn().mockResolvedValue({
      current: '0.1.0', latest: 'v0.2.0', updateAvailable: true, notesUrl: null,
      checkedAt: '2026-08-15T00:00:00Z',
    });
    await systemUpdateCheck({ system: { updateCheck } } as never, false);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('releases/tag/v0.2.0');
  });

  it('reports the latest release when up to date', async () => {
    const updateCheck = vi.fn().mockResolvedValue({
      current: '0.1.0', latest: '0.1.0', updateAvailable: false, notesUrl: null,
      checkedAt: '2026-08-15T00:00:00Z',
    });
    await systemUpdateCheck({ system: { updateCheck } } as never, false);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('latest release');
  });

  it('reports unknown when the feed is unreachable or disabled', async () => {
    const updateCheck = vi.fn().mockResolvedValue({
      current: '0.1.0', latest: null, updateAvailable: null, notesUrl: null,
      checkedAt: '2026-08-15T00:00:00Z',
    });
    await systemUpdateCheck({ system: { updateCheck } } as never, false);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('Latest release unknown');
  });
});
