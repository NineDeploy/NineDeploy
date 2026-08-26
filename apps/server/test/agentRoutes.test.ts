import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentRoutes, runOp } from '../src/agent.js';
import { buildTestApp } from './helpers.js';

const spawnMock = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('../src/lib/spawnValidated.js', () => ({ spawnValidated: spawnMock }));
const dockerPullMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/lib/dockerPull.js', () => ({ pullDockerImage: dockerPullMock }));

const TOKEN = 'agent-shared-token';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-agent-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function appWith() {
  const app = await buildTestApp();
  await app.register(agentRoutes, { tokenHash: TOKEN_HASH });
  return app;
}

describe('agent /agent/exec route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockReset();
    spawnMock.mockResolvedValue(0);
  });

  it('rejects a bad token', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': 'wrong' },
      payload: { op: 'docker.pull', params: { image: 'nginx' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown operations', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 'bash.start', params: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unknown_op');
  });

  it('executes a typed operation and returns its lines', async () => {
    spawnMock.mockImplementation(async (_exe, _argv, onLine) => {
      onLine?.('stopping web-3');
      return 0;
    });
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 'docker.stop', params: { name: 'web-3' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().exitCode).toBe(0);
    expect(res.json().lines).toEqual(['stopping web-3']);
    expect(res.json().envFile).toBeNull();
    expect(spawnMock).toHaveBeenCalledWith('docker', ['stop', '-t', '5', 'web-3'], expect.any(Function));
  });

  it('surfaces operand validation failures as 400', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 'docker.pull', params: { image: 'nginx; rm -rf /' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_params');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('writes env files for file.writeEnv and returns their path', async () => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const app = await appWith();
      const res = await app.inject({
        method: 'POST', url: '/agent/exec',
        headers: { 'x-agent-token': TOKEN },
        payload: { op: 'file.writeEnv', params: { name: 'testenv', env: { KEY: 'value' } } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().envFile).toContain('testenv');

      const resDel = await app.inject({
        method: 'POST', url: '/agent/exec',
        headers: { 'x-agent-token': TOKEN },
        payload: { op: 'file.deleteEnv', params: { name: 'testenv' } },
      });
      expect(resDel.statusCode).toBe(200);
      expect(resDel.json().exitCode).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it('reports non-Error op failures generically', async () => {
    dockerPullMock.mockRejectedValueOnce('plain boom');
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 'docker.pull', params: { image: 'nginx' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Invalid params');
  });

  it('registers without an option object or env hash', async () => {
    const app = await buildTestApp();
    delete process.env['NINEDEPLOY_AGENT_TOKEN'];
    await app.register(agentRoutes);
    // No token hash â†’ every token is rejected.
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': 'anything' },
      payload: { op: 'docker.pull', params: { image: 'nginx' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('executes file.deleteEnv via the route', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 'file.deleteEnv', params: { name: 'never-existed' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().exitCode).toBe(0);
  });

  it('handles empty request bodies and non-string ops', async () => {
    const app = await appWith();
    const noBody = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 42, params: 'nonsense' },
    });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json().error.code).toBe('unknown_op');
  });

  it('falls back to the env token hash when the option is omitted', async () => {
    const app = await buildTestApp();
    process.env['NINEDEPLOY_AGENT_TOKEN'] = TOKEN_HASH;
    try {
      await app.register(agentRoutes);
      const res = await app.inject({
        method: 'POST', url: '/agent/exec',
        headers: { 'x-agent-token': TOKEN },
        payload: { op: 'nope', params: {} },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      delete process.env['NINEDEPLOY_AGENT_TOKEN'];
    }
  });

  it('treats a missing body as an empty object', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unknown_op');
  });

  it('treats a null params object as empty', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST', url: '/agent/exec',
      headers: { 'x-agent-token': TOKEN },
      payload: { op: 'unknown-thing', params: null },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unknown_op');
  });

  it('answers the ping probe', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/agent/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, agent: true });
  });
});

describe('runOp env-file helpers', () => {
  it('deletes a previously written env file', async () => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      await runOp('file.writeEnv', { name: 'delenv', env: { A: 'b' } }, () => {});
      const code = await runOp('file.deleteEnv', { name: 'delenv' }, () => {});
      expect(code).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it('rejects a string env payload', async () => {
    await expect(
      runOp('file.writeEnv', { name: 'x', env: 'not-an-object' }, () => {}),
    ).rejects.toThrow('Invalid env');
  });

  it('rejects env values with newlines', async () => {
    await expect(
      runOp('file.writeEnv', { name: 'badenv', env: { A: 'x\nB=1' } }, () => {}),
    ).rejects.toThrow('Invalid env value');
  });

  it('returns -1 for an unknown op in runOp', async () => {
    const code = await runOp('unknown.op', {}, () => {});
    expect(code).toBe(-1);
  });
});
