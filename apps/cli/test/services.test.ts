import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  servicesCreate,
  servicesDelete,
  servicesDeploy,
  servicesExport,
  servicesGet,
  servicesLifecycle,
  servicesList,
  servicesLogs,
} from '../src/commands/services.js';

const h = vi.hoisted(() => {
  class NineDeployError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    NineDeployError,
    prompt: vi.fn(),
    writeFileSync: vi.fn(),
    loadConfig: vi.fn(),
  };
});

vi.mock('@ninedeploy/sdk', () => ({ NineDeployError: h.NineDeployError }));
vi.mock('../src/prompts.js', () => ({ prompt: h.prompt }));
vi.mock('../src/config.js', () => ({ loadConfig: h.loadConfig }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeFileSync: h.writeFileSync,
}));

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    services: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      logs: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
      restart: vi.fn(),
      remove: vi.fn(),
    },
    deploys: { trigger: vi.fn() },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  h.prompt.mockResolvedValue('');
  fetchMock = vi.fn().mockResolvedValue({ text: vi.fn().mockResolvedValue('{"data":1}') });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('servicesList', () => {
  it('prints a hint when there are no services', async () => {
    const client = makeClient({ services: { list: vi.fn().mockResolvedValue([]) } });

    await servicesList(client);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No services yet.'));
  });

  it('tables services, defaulting a missing port', async () => {
    const list = vi.fn().mockResolvedValue([
      { id: 1, name: 'api', type: 'docker', status: 'running', port: 3000, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'web', type: 'git', status: 'stopped', port: null, updatedAt: '2026-01-02T00:00:00Z' },
    ]);
    const client = makeClient({ services: { list } });

    await servicesList(client);

    expect(list).toHaveBeenCalledOnce();
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('api');
    expect(text).toContain('3000');
    expect(text).toContain('—');
  });
});

describe('servicesCreate', () => {
  it('requires a name', async () => {
    h.prompt.mockResolvedValueOnce('');

    await servicesCreate(makeClient(), undefined as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Name is required'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('creates from a git repo and deploys when confirmed', async () => {
    const create = vi.fn().mockResolvedValue({ id: 7, name: 'api' });
    const trigger = vi.fn().mockResolvedValue({ deploymentId: 12 });
    const client = makeClient({ services: { create }, deploys: { trigger } });
    h.prompt
      .mockResolvedValueOnce('api') // name
      .mockResolvedValueOnce('1') // repo mode
      .mockResolvedValueOnce('https://github.com/acme/api') // repo url
      .mockResolvedValueOnce('main') // branch
      .mockResolvedValueOnce('') // port
      .mockResolvedValueOnce('') // volume
      .mockResolvedValueOnce('y'); // deploy now

    await servicesCreate(client);

    expect(create).toHaveBeenCalledWith({
      name: 'api',
      type: 'docker',
      repoUrl: 'https://github.com/acme/api',
      image: undefined,
      branch: 'main',
      port: undefined,
      volumeMount: undefined,
    });
    expect(trigger).toHaveBeenCalledWith(7);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Service "api" created'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Deployment #12 queued'));
  });

  it('requires a repo url in git mode', async () => {
    h.prompt.mockResolvedValueOnce('api').mockResolvedValueOnce('1').mockResolvedValueOnce('');

    await servicesCreate(makeClient(), undefined as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Repository URL is required'));
  });

  it('creates from a docker image and skips deployment when declined', async () => {
    const create = vi.fn().mockResolvedValue({ id: 3, name: 'img' });
    const trigger = vi.fn();
    const client = makeClient({ services: { create }, deploys: { trigger } });
    h.prompt
      .mockResolvedValueOnce('img') // name
      .mockResolvedValueOnce('2') // docker mode
      .mockResolvedValueOnce('nginx:alpine') // image
      .mockResolvedValueOnce('8080') // port
      .mockResolvedValueOnce('/data') // volume
      .mockResolvedValueOnce('n'); // deploy now

    await servicesCreate(client);

    expect(create).toHaveBeenCalledWith({
      name: 'img',
      type: 'docker',
      repoUrl: undefined,
      image: 'nginx:alpine',
      branch: 'main',
      port: 8080,
      volumeMount: '/data',
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it('requires an image in docker mode', async () => {
    h.prompt.mockResolvedValueOnce('img').mockResolvedValueOnce('2').mockResolvedValueOnce('');

    await servicesCreate(makeClient(), undefined as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Image is required'));
  });

  it('reports a NineDeployError from the client', async () => {
    const create = vi.fn().mockRejectedValue(new h.NineDeployError(409, 'conflict'));
    h.prompt
      .mockResolvedValueOnce('api')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('https://github.com/acme/api')
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('y');

    await servicesCreate(makeClient({ services: { create } }), undefined as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('conflict'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reports a generic Error from the client', async () => {
    const create = vi.fn().mockRejectedValue(new Error('network down'));
    h.prompt
      .mockResolvedValueOnce('api')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('https://github.com/acme/api')
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('y');

    await servicesCreate(makeClient({ services: { create } }), undefined as never);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });
});

describe('servicesGet', () => {
  it('requires a numeric service id', async () => {
    await servicesGet(makeClient(), 'abc');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('prints every detail field', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 1,
      name: 'api',
      slug: 'api',
      type: 'docker',
      status: 'running',
      repoUrl: 'https://github.com/acme/api',
      branch: 'main',
      image: 'nginx',
      port: 3000,
      volumeMount: '/data',
      healthPath: '/health',
      runtimeId: 'rt-1',
      commitSha: 'abc123',
      autoUrl: 'api.example.com',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
    const client = makeClient({ services: { get } });

    await servicesGet(client, '17');

    expect(get).toHaveBeenCalledWith(17);
    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('api');
    expect(text).toContain('http://api.example.com');
  });

  it('prints dashes for missing fields and skips the URL when absent', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 2,
      name: 'web',
      slug: 'web',
      type: 'git',
      status: 'weird',
      repoUrl: null,
      branch: 'main',
      image: null,
      port: null,
      volumeMount: null,
      healthPath: '/',
      runtimeId: null,
      commitSha: null,
      autoUrl: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const client = makeClient({ services: { get } });

    await servicesGet(client, '17');

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('—');
    expect(text).not.toContain('http://');
  });
});

describe('servicesDeploy', () => {
  it('requires a numeric service id', async () => {
    await servicesDeploy(makeClient(), '0');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('triggers a deployment', async () => {
    const trigger = vi.fn().mockResolvedValue({ deploymentId: 5 });
    const client = makeClient({ deploys: { trigger } });

    await servicesDeploy(client, '3');

    expect(trigger).toHaveBeenCalledWith(3);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Deployment #5 queued.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ninedeploy services logs 3'));
  });

  it('reports a failure', async () => {
    const client = makeClient({ deploys: { trigger: vi.fn().mockRejectedValue(new Error('denied')) } });

    await servicesDeploy(client, '3');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('denied'));
  });

  it('reports a non-Error rejection', async () => {
    const client = makeClient({ deploys: { trigger: vi.fn().mockRejectedValue('boom') } });

    await servicesDeploy(client, '3');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('servicesLogs', () => {
  it('requires a numeric service id', async () => {
    await servicesLogs(makeClient(), 'x');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('prints a notice for empty logs', async () => {
    const client = makeClient({ services: { logs: vi.fn().mockResolvedValue({ lines: '   ' }) } });

    await servicesLogs(client, '9');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No logs yet.'));
  });

  it('prints the log lines', async () => {
    const client = makeClient({ services: { logs: vi.fn().mockResolvedValue({ lines: 'line one\nline two' }) } });

    await servicesLogs(client, '9');

    const text = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(text).toContain('line one');
    expect(text).toContain('line two');
  });

  it('reports a failure', async () => {
    const client = makeClient({ services: { logs: vi.fn().mockRejectedValue(new Error('gone')) } });

    await servicesLogs(client, '9');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('gone'));
  });

  it('reports a non-Error rejection', async () => {
    const client = makeClient({ services: { logs: vi.fn().mockRejectedValue('boom') } });

    await servicesLogs(client, '9');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('servicesLifecycle', () => {
  it('requires a numeric service id', async () => {
    await servicesLifecycle(makeClient(), 'stop', 'abc');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('services stop <id>'));
  });

  it.each(['stop', 'start', 'restart'])('%s a service', async (action) => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({ services: { [action]: fn } });

    await servicesLifecycle(client, action as 'stop', '4');

    expect(fn).toHaveBeenCalledWith(4);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`Service ${action}ed.`));
  });

  it('reports a failure', async () => {
    const client = makeClient({ services: { stop: vi.fn().mockRejectedValue(new Error('refused')) } });

    await servicesLifecycle(client, 'stop', '4');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('refused'));
  });

  it('reports a non-Error rejection', async () => {
    const client = makeClient({ services: { start: vi.fn().mockRejectedValue('boom') } });

    await servicesLifecycle(client, 'start', '4');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('servicesDelete', () => {
  it('requires a numeric service id', async () => {
    await servicesDelete(makeClient(), '');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('cancels when the confirmation does not match', async () => {
    h.prompt.mockResolvedValueOnce('999');

    await servicesDelete(makeClient(), '5');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cancelled.'));
  });

  it('deletes after confirmation', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    h.prompt.mockResolvedValueOnce('5');

    await servicesDelete(makeClient({ services: { remove } }), '5');

    expect(remove).toHaveBeenCalledWith(5);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Service deleted.'));
  });

  it('reports a failure', async () => {
    h.prompt.mockResolvedValueOnce('6');
    const client = makeClient({ services: { remove: vi.fn().mockRejectedValue(new Error('locked')) } });

    await servicesDelete(client, '6');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('locked'));
  });

  it('reports a non-Error rejection', async () => {
    h.prompt.mockResolvedValueOnce('6');
    const client = makeClient({ services: { remove: vi.fn().mockRejectedValue('boom') } });

    await servicesDelete(client, '6');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('servicesExport', () => {
  it('requires a numeric service id', async () => {
    await servicesExport(makeClient(), 'no');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('downloads and writes the export when no token is configured', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://localhost:3000' });
    const get = vi.fn().mockResolvedValue({ slug: 'api' });
    const client = makeClient({ services: { get } });

    await servicesExport(client, '7');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/v1/services/7/export', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(h.writeFileSync).toHaveBeenCalledWith('api-export.json', '{"data":1}');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Exported to api-export.json'));
  });

  it('includes a token when the config has one', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://srv:3000', token: 'tok' });
    const client = makeClient({
      services: { get: vi.fn().mockResolvedValue({ slug: 'api' }) },
    });

    await servicesExport(client, '7');

    expect(fetchMock).toHaveBeenCalledWith('http://srv:3000/v1/services/7/export', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('reports a fetch failure', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://localhost:3000' });
    fetchMock.mockRejectedValue(new Error('offline'));
    const client = makeClient({ services: { get: vi.fn().mockResolvedValue({ slug: 'api' }) } });

    await servicesExport(client, '7');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('offline'));
  });

  it('reports a non-Error fetch rejection', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://localhost:3000' });
    fetchMock.mockRejectedValue('boom');
    const client = makeClient({ services: { get: vi.fn().mockResolvedValue({ slug: 'api' }) } });

    await servicesExport(client, '7');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
