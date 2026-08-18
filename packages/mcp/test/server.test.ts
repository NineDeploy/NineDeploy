import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, DEFAULT_IO, isDirectRun, main, staticToken } from '../src/index.js';
import type { NineDeployClient } from '@ninedeploy/sdk';

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    mock = true;
  },
}));

/** End-to-end over an in-memory MCP transport with a fake SDK client. */
async function connected(client: NineDeployClient) {
  const server = buildServer(client);
  const mcp = new Client({ name: 'test', version: '0' });
  const [cs, ss] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(cs), server.connect(ss)]);
  return mcp;
}

const fake = () =>
  ({
    services: { list: vi.fn(async () => [{ id: 1, name: 'api', status: 'running' }]), restart: vi.fn(async () => ({ ok: true })) },
    deploys: { trigger: vi.fn(async () => ({ deploymentId: 42 })) },
  }) as unknown as NineDeployClient;

describe('buildServer', () => {
  it('lists all tools with schemas', async () => {
    const mcp = await connected(fake());
    const tools = await mcp.listTools();
    expect(tools.tools).toHaveLength(28);
    expect(tools.tools.map((t) => t.name)).toContain('deploy_service');
    expect(tools.tools.map((t) => t.name)).toContain('list_services');
    expect(tools.tools.map((t) => t.name)).toContain('seed_demo');
    expect(tools.tools.map((t) => t.name)).toContain('update_service');
    expect(tools.tools.map((t) => t.name)).toContain('list_plugins');
    expect(tools.tools.map((t) => t.name)).toContain('list_configs');
  });

  it('serves a tool call as JSON text', async () => {
    const c = fake();
    const mcp = await connected(c);
    const res = await mcp.callTool({ name: 'list_services', arguments: {} });
    expect(res.content).toEqual([{ type: 'text', text: JSON.stringify([{ id: 1, name: 'api', status: 'running' }], null, 2) }]);
  });

  it('rejects invalid arguments with isError', async () => {
    const mcp = await connected(fake());
    const res = await mcp.callTool({ name: 'deploy_service', arguments: { serviceId: -1 } });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toMatch(/Invalid/i);
  });

  it('stringifies non-Error handler failures', async () => {
    const c = fake();
    (c.deploys.trigger as ReturnType<typeof vi.fn>).mockRejectedValue('plain-failure');
    const mcp = await connected(c);
    const res = await mcp.callTool({ name: 'deploy_service', arguments: { serviceId: 1 } });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect((res.content as Array<{ type: string; text: string }>)[0]!.text).toBe('plain-failure');
  });

  it('rejects absent arguments at the protocol layer', async () => {
    const mcp = await connected(fake());
    const res = await mcp.callTool({ name: 'list_services', arguments: undefined });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toContain('-32602');
  });

  it('surfaces handler failures as isError, not crashes', async () => {
    const c = fake();
    (c.deploys.trigger as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const mcp = await connected(c);
    const res = await mcp.callTool({ name: 'deploy_service', arguments: { serviceId: 1 } });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect((res.content as Array<{ type: string; text: string }>)[0]!.text).toBe('boom');
  });
});

describe('main (entrypoint wiring)', () => {
  it('exits with an error when NINEDEPLOY_TOKEN is missing', async () => {
    const error = vi.fn();
    const exit = vi.fn();
    await main({}, { error, exit, connect: async () => {} });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('NINEDEPLOY_TOKEN is required'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('connects the built server when configured', async () => {
    const error = vi.fn();
    const exit = vi.fn();
    const connect = vi.fn(async () => {});
    await main({ NINEDEPLOY_TOKEN: 'tok', NINEDEPLOY_URL: 'http://x' }, { error, exit, connect });
    expect(connect).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('production defaults', () => {
  it('DEFAULT_IO.error writes to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    DEFAULT_IO.error('mcp-msg');
    expect(spy).toHaveBeenCalledWith('mcp-msg');
    spy.mockRestore();
  });

  it('DEFAULT_IO.connect wires the server to a stdio transport', async () => {
    const server = { connect: vi.fn(async () => {}) } as unknown as Parameters<typeof DEFAULT_IO.connect>[0];
    await DEFAULT_IO.connect(server);
    expect(server.connect).toHaveBeenCalledOnce();
    const transport = (server.connect as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { mock?: boolean };
    expect(transport).toBeInstanceOf(Object);
    expect((transport as { mock?: boolean }).mock).toBe(true);
  });

  it('isDirectRun only matches when argv[1] resolves to this module', () => {
    // The self URL comparison must accept both the compiled entrypoint and
    // the TS source path forms of this very module…
    const self = new URL(`file:///ninedeploy/dist/index.js`).href;
    expect(isDirectRun('/ninedeploy/dist/index.js', self)).toBe(true);
    const selfTs = new URL(`file:///ninedeploy/src/index.ts`).href;
    expect(isDirectRun('/ninedeploy/src/index.ts', selfTs)).toBe(true);
    // …and reject any other package's identically-named entrypoint.
    expect(isDirectRun('/other/dist/index.js', self)).toBe(false);
    expect(isDirectRun('/x/test/server.test.ts', self)).toBe(false);
    expect(isDirectRun(undefined, self)).toBe(false);
    expect(isDirectRun('://bad-url\0', self)).toBe(false);
  });

  it('staticToken returns a closure yielding the token', () => {
    expect(staticToken('abc')()).toBe('abc');
  });

  it('DEFAULT_IO.exit terminates the process with the code', () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    DEFAULT_IO.exit(3);
    expect(spy).toHaveBeenCalledWith(3);
    spy.mockRestore();
  });

  it('runs main automatically when imported as the direct entrypoint', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prev = process.argv[1];
    // The direct-run check compares argv[1] against the module's own URL —
    // under vitest the module's URL is the .ts source path.
    process.argv[1] = fileURLToPath(new URL('../src/index.ts', import.meta.url));
    delete process.env['NINEDEPLOY_TOKEN'];
    vi.resetModules();
    await import('../src/index.js');
    // main() ran with no token: it wrote the usage error and exited 1.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('NINEDEPLOY_TOKEN is required'));
    expect(spy).toHaveBeenCalledWith(1);
    process.argv[1] = prev;
    spy.mockRestore();
    errSpy.mockRestore();
  });
});
