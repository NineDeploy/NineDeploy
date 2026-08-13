import * as fs from 'node:fs';
import { Module } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * index.ts runs `program.parseAsync().catch(...)` at module load and several
 * actions call `process.exit`, so the real commander would parse vitest's argv
 * and kill the worker. We mock 'commander' with a recording fake, stub
 * process.exit / process.argv, and drive each registered action directly.
 *
 * The logout/config actions call `require('./config.js')`. The vitest module
 * runner executes that with native `createRequire` resolution, which only finds
 * real files — and src/config.js does not exist (it is config.ts). We therefore
 * patch Module._resolveFilename to redirect './config.js' requests that come
 * from src/index.ts to a per-test CJS shim under os.tmpdir().
 */

const INDEX_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

const h = vi.hoisted(() => {
  class FakeCommand {
    static instances: FakeCommand[] = [];
    static parseOverride: Promise<unknown> | null = null;

    cmdName = '';
    desc = '';
    opts: Record<string, unknown> = {};
    actionFn: ((...args: unknown[]) => unknown) | undefined;
    parseResult: Promise<unknown> = Promise.resolve();
    children: FakeCommand[] = [];

    constructor() {
      FakeCommand.instances.push(this);
    }

    name(n?: string) {
      if (n !== undefined) this.cmdName = n;
      return this;
    }

    description(d?: string) {
      if (d !== undefined) this.desc = d;
      return this;
    }

    version() {
      return this;
    }

    helpOption() {
      return this;
    }

    option(flags: string, opts?: unknown) {
      this.opts = { flags, opts };
      return this;
    }

    command(name: string) {
      const child = new FakeCommand();
      child.cmdName = name;
      this.children.push(child);
      return child;
    }

    action(fn: (...args: unknown[]) => unknown) {
      this.actionFn = fn;
      return this;
    }

    parseAsync() {
      return FakeCommand.parseOverride ?? this.parseResult;
    }
  }

  return {
    FakeCommand,
    exit: vi.fn(),
    getClient: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    loginAction: vi.fn(),
    setupAction: vi.fn(),
    servicesList: vi.fn(),
    servicesCreate: vi.fn(),
    servicesGet: vi.fn(),
    servicesDeploy: vi.fn(),
    servicesLogs: vi.fn(),
    servicesLifecycle: vi.fn(),
    servicesDelete: vi.fn(),
    servicesExport: vi.fn(),
    dbList: vi.fn(),
    dbCreate: vi.fn(),
    tplList: vi.fn(),
    tplDeploy: vi.fn(),
    deploysList: vi.fn(),
    deploysRollback: vi.fn(),
    tokenCreate: vi.fn(),
    tokenList: vi.fn(),
    systemInfo: vi.fn(),
    systemDashboard: vi.fn(),
    banner: vi.fn(),
  };
});

vi.mock('commander', () => ({ Command: h.FakeCommand }));
vi.mock('../src/client.js', () => ({ getClient: h.getClient }));
vi.mock('../src/config.js', () => ({ loadConfig: h.loadConfig, saveConfig: h.saveConfig }));
vi.mock('../src/commands/login.js', () => ({ loginAction: h.loginAction }));
vi.mock('../src/commands/setup.js', () => ({ setupAction: h.setupAction }));
vi.mock('../src/commands/services.js', () => ({
  servicesCreate: h.servicesCreate,
  servicesDelete: h.servicesDelete,
  servicesDeploy: h.servicesDeploy,
  servicesExport: h.servicesExport,
  servicesGet: h.servicesGet,
  servicesLifecycle: h.servicesLifecycle,
  servicesList: h.servicesList,
  servicesLogs: h.servicesLogs,
}));
vi.mock('../src/commands/misc.js', () => ({
  dbCreate: h.dbCreate,
  dbList: h.dbList,
  deploysList: h.deploysList,
  deploysRollback: h.deploysRollback,
  systemDashboard: h.systemDashboard,
  systemInfo: h.systemInfo,
  tplDeploy: h.tplDeploy,
  tplList: h.tplList,
  tokenCreate: h.tokenCreate,
  tokenList: h.tokenList,
}));
vi.mock('../src/lib/format.js', () => ({ banner: h.banner }));

// ── require('./config.js') shim ─────────────────────────────────────────────

// The runner caches a required module after the first load, so per-test shim
// files are not re-resolved. Instead, one fixed shim reads a per-test state
// file at call time and writes a fixed record file — the cached module always
// sees the current test's values.

let shimDir = '';
let shimFile = '';
let stateFile = '';
let recordFile = '';

function setupShim(config: { baseUrl: string; token?: string }) {
  const state = 'token' in config ? config : { baseUrl: config.baseUrl, token: undefined };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.rmSync(recordFile, { force: true });
}

function readRecord(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(recordFile, 'utf8')) as Record<string, unknown>;
}

const origResolveFilename = Module._resolveFilename;

beforeAll(() => {
  shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ninedeploy-cli-require-'));
  shimFile = path.join(shimDir, 'config.cjs');
  stateFile = path.join(shimDir, 'state.json');
  recordFile = path.join(shimDir, 'record.json');
  fs.writeFileSync(
    shimFile,
    "const fs = require('node:fs');\n" +
      'module.exports = {\n' +
      `  loadConfig: () => JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')),\n` +
      `  saveConfig: (cfg) => fs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify(cfg)),\n` +
      '};\n',
  );
});

afterAll(() => {
  fs.rmSync(shimDir, { recursive: true, force: true });
});

let argvBackup: string[];

beforeEach(() => {
  vi.resetModules();
  h.FakeCommand.instances.length = 0;
  h.FakeCommand.parseOverride = null;
  vi.clearAllMocks();

  argvBackup = process.argv;
  // A normal CLI invocation: node + script + at least one argument.
  process.argv = ['/usr/bin/node', '/app/dist/index.js', 'some', 'args'];

  Module._resolveFilename = function (this: unknown, request, parent, isMain, options) {
    const parentFilename = (parent as { filename?: string } | null | undefined)?.filename;
    if (
      request === './config.js' &&
      typeof parentFilename === 'string' &&
      path.resolve(parentFilename) === INDEX_PATH
    ) {
      return shimFile;
    }
    return origResolveFilename.call(this, request, parent, isMain, options);
  };

  vi.spyOn(process, 'exit').mockImplementation(h.exit);
  h.loadConfig.mockReturnValue({ baseUrl: 'http://localhost:3000' });
  h.getClient.mockReturnValue({ auth: { me: vi.fn(), tokens: { create: vi.fn(), list: vi.fn() } } });
});

afterEach(() => {
  Module._resolveFilename = origResolveFilename;
  process.argv = argvBackup;
  vi.restoreAllMocks();
});

async function loadIndex() {
  return await import('../src/index.js');
}

function rootCommand() {
  const root = h.FakeCommand.instances[0];
  if (!root) throw new Error('index.ts did not construct a Command');
  return root;
}

function findCommand(name: string) {
  const cmd = rootCommand().children.find((c) => c.cmdName === name);
  if (!cmd) throw new Error(`command not registered: ${name}`);
  return cmd;
}

describe('program registration', () => {
  it('registers the CLI with name, description, and all subcommands', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();

    const root = rootCommand();
    expect(root.cmdName).toBe('ninedeploy');
    expect(root.desc).toContain('NineDeploy');
    expect(root.children.map((c) => c.cmdName)).toEqual([
      'setup', 'login', 'logout', 'whoami', 'config',
      'services', 'databases', 'templates', 'deploys', 'token', 'system',
    ]);
    expect(findCommand('services').children).toHaveLength(10);
    expect(findCommand('databases').children).toHaveLength(2);
    expect(findCommand('templates').children).toHaveLength(2);
    expect(findCommand('deploys').children).toHaveLength(2);
    expect(findCommand('token').children).toHaveLength(2);
    expect(findCommand('system').children).toHaveLength(2);
    // 1 root + 11 direct + 10 + 2 + 2 + 2 + 2 + 2 nested
    expect(h.FakeCommand.instances).toHaveLength(32);
    // argv length > 2 → no banner, no exit
    expect(h.banner).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('shows the quick-start banner when invoked without arguments', async () => {
    process.argv = ['/usr/bin/node', '/app/dist/index.js'];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();

    expect(h.banner).toHaveBeenCalledOnce();
    const lines = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(lines).toContain('Quick start');
    expect(lines).toContain('Browse templates');
    expect(lines).toContain('Deploy a service');
    expect(lines).toContain('View dashboard');
    expect(lines).toContain('Full help');
    expect(h.exit).toHaveBeenCalledWith(0);
  });
});

describe('parseAsync failure handling', () => {
  it('prints the error message and exits when parsing fails with an Error', async () => {
    h.FakeCommand.parseOverride = Promise.reject(new Error('bad option'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await loadIndex();

    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(1));
    expect(errorSpy).toHaveBeenCalledWith('\n  ✗ bad option\n');
  });

  it('prints the raw value when parsing fails with a non-Error', async () => {
    h.FakeCommand.parseOverride = Promise.reject('oops');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await loadIndex();

    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(1));
    expect(errorSpy).toHaveBeenCalledWith('oops');
  });
});

describe('whoami action', () => {
  it('prints a hint and exits when not logged in', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://localhost:3000' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('whoami').actionFn!();

    expect(logSpy).toHaveBeenCalledWith('  Not logged in. Run `ninedeploy login`.');
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it('prints the authenticated user and server', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://srv:3000', token: 'tok' });
    h.getClient.mockReturnValue({
      auth: { me: vi.fn().mockResolvedValue({ email: 'a@b.com', role: 'admin' }) },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('whoami').actionFn!();

    expect(logSpy).toHaveBeenCalledWith('  a@b.com  (admin)  @  http://srv:3000');
    expect(h.exit).not.toHaveBeenCalled();
  });

  it('reports an expired token when auth fails', async () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://srv:3000', token: 'tok' });
    h.getClient.mockReturnValue({
      auth: { me: vi.fn().mockRejectedValue(new Error('401')) },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('whoami').actionFn!();

    expect(logSpy).toHaveBeenCalledWith('  Token expired. Run `ninedeploy login`.');
    expect(h.exit).toHaveBeenCalledWith(1);
  });
});

describe('config action', () => {
  it('sets a new server URL', async () => {
    setupShim({ baseUrl: 'http://old:3000', token: 'tok' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('config').actionFn!({ server: 'http://new:3000' });

    expect(readRecord()).toEqual({ baseUrl: 'http://new:3000', token: 'tok' });
    expect(logSpy).toHaveBeenCalledWith('  ✓ Server set to http://new:3000');
  });

  it('shows the current server and token state', async () => {
    setupShim({ baseUrl: 'http://srv:3000', token: 'tok' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('config').actionFn!({});

    expect(logSpy).toHaveBeenCalledWith('  Server:  http://srv:3000');
    expect(logSpy).toHaveBeenCalledWith('  Token:   ✓ configured');
  });

  it('reports a missing token', async () => {
    setupShim({ baseUrl: 'http://srv:3000' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('config').actionFn!({});

    expect(logSpy).toHaveBeenCalledWith('  Server:  http://srv:3000');
    expect(logSpy).toHaveBeenCalledWith('  Token:   ✗ not set');
  });
});

describe('logout action', () => {
  it('clears stored credentials', async () => {
    setupShim({ baseUrl: 'http://srv:3000', token: 'tok' });
    h.loadConfig.mockReturnValue({ baseUrl: 'http://srv:3000', token: 'tok' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await loadIndex();
    await findCommand('logout').actionFn!();

    expect(readRecord()).toEqual({ baseUrl: 'http://srv:3000' });
    expect(logSpy).toHaveBeenCalledWith('  ✓ Signed out.');
  });
});

describe('delegating actions', () => {
  it('setup and login delegate to their action modules', async () => {
    await loadIndex();

    await findCommand('setup').actionFn!();
    await findCommand('login').actionFn!();

    expect(h.setupAction).toHaveBeenCalledOnce();
    expect(h.loginAction).toHaveBeenCalledOnce();
  });

  it('wires every services subcommand to the client', async () => {
    const client = { fake: true };
    h.getClient.mockReturnValue(client);

    await loadIndex();
    const services = findCommand('services');
    const cmds = new Map(services.children.map((c) => [c.cmdName, c]));

    await cmds.get('list')!.actionFn!();
    expect(h.servicesList).toHaveBeenCalledWith(client);

    await cmds.get('create')!.actionFn!();
    expect(h.servicesCreate).toHaveBeenCalledWith(client);

    await cmds.get('get <id>')!.actionFn!('17');
    expect(h.servicesGet).toHaveBeenCalledWith(client, '17');

    await cmds.get('deploy <id>')!.actionFn!('3');
    expect(h.servicesDeploy).toHaveBeenCalledWith(client, '3');

    await cmds.get('logs <id>')!.actionFn!('9');
    expect(h.servicesLogs).toHaveBeenCalledWith(client, '9');

    await cmds.get('stop <id>')!.actionFn!('1');
    expect(h.servicesLifecycle).toHaveBeenCalledWith(client, 'stop', '1');

    await cmds.get('start <id>')!.actionFn!('2');
    expect(h.servicesLifecycle).toHaveBeenCalledWith(client, 'start', '2');

    await cmds.get('restart <id>')!.actionFn!('4');
    expect(h.servicesLifecycle).toHaveBeenCalledWith(client, 'restart', '4');

    await cmds.get('delete <id>')!.actionFn!('5');
    expect(h.servicesDelete).toHaveBeenCalledWith(client, '5');

    await cmds.get('export <id>')!.actionFn!('6');
    expect(h.servicesExport).toHaveBeenCalledWith(client, '6');
  });

  it('wires databases, templates, deploys, token, and system subcommands', async () => {
    const client = { fake: true };
    h.getClient.mockReturnValue(client);

    await loadIndex();

    const databases = findCommand('databases');
    await databases.children.find((c) => c.cmdName === 'list')!.actionFn!();
    expect(h.dbList).toHaveBeenCalledWith(client);
    await databases.children.find((c) => c.cmdName === 'create')!.actionFn!();
    expect(h.dbCreate).toHaveBeenCalledWith(client);

    const templates = findCommand('templates');
    await templates.children.find((c) => c.cmdName === 'list')!.actionFn!();
    expect(h.tplList).toHaveBeenCalledWith(client);
    await templates.children.find((c) => c.cmdName === 'deploy <id>')!.actionFn!('nextjs');
    expect(h.tplDeploy).toHaveBeenCalledWith(client, 'nextjs');

    const deploys = findCommand('deploys');
    await deploys.children.find((c) => c.cmdName === 'list <serviceId>')!.actionFn!('21');
    expect(h.deploysList).toHaveBeenCalledWith(client, '21');
    await deploys.children.find((c) => c.cmdName === 'rollback <serviceId> <deployId>')!.actionFn!('21', '99');
    expect(h.deploysRollback).toHaveBeenCalledWith(client, '21', '99');

    const token = findCommand('token');
    await token.children.find((c) => c.cmdName === 'create')!.actionFn!();
    expect(h.tokenCreate).toHaveBeenCalledWith(client);
    await token.children.find((c) => c.cmdName === 'list')!.actionFn!();
    expect(h.tokenList).toHaveBeenCalledWith(client);

    const system = findCommand('system');
    await system.children.find((c) => c.cmdName === 'info')!.actionFn!();
    expect(h.systemInfo).toHaveBeenCalledWith(client);
    await system.children.find((c) => c.cmdName === 'dashboard')!.actionFn!();
    expect(h.systemDashboard).toHaveBeenCalledWith(client);
  });
});
