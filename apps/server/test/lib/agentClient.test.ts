import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentOp, agentPing, generateAgentToken, tokenMatches } from '../../src/lib/agentClient.js';
import { createFakeDb } from '../helpers.js';

const cryptoReal = await import('../../src/lib/crypto.js');

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

const serverRow = {
  id: 1, name: 'edge', host: '10.0.0.5', port: 4600, status: 'online',
  tokenEncrypted: cryptoReal.encrypt('raw-token'),
  lastSeenAt: null, createdAt: new Date(0), updatedAt: new Date(0),
};

describe('tokenMatches', () => {
  it('compares sha256 digests in constant time', async () => {
    const token = generateAgentToken();
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(token).digest('hex');
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches('wrong', hash)).toBe(false);
    expect(tokenMatches(token, 'short')).toBe(false);
  });
});

describe('generateAgentToken', () => {
  it('produces fresh url-safe tokens', () => {
    const a = generateAgentToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(generateAgentToken());
  });
});

describe('agentOp', () => {
  beforeEach(() => fetchMock.mockReset());

  it('POSTs the typed op with the decrypted token and streams lines', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ lines: ['a', 'b'], exitCode: 0 }) });
    const lines: string[] = [];
    const res = await agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', { image: 'nginx' }, (l) => lines.push(l));
    expect(res).toEqual({ exitCode: 0, lines: ['a', 'b'] });
    expect(lines).toEqual(['a', 'b']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:4600/agent/exec');
    expect((init.headers as Record<string, string>)['x-agent-token']).toBe('raw-token');
    expect(JSON.parse(String(init.body))).toEqual({ op: 'docker.pull', params: { image: 'nginx' } });
  });

  it('throws on transport errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, () => {}),
    ).rejects.toThrow('agent docker.pull failed (401)');
  });

  it('throws on non-zero exit codes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ lines: [], exitCode: 1 }) });
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, () => {}),
    ).rejects.toThrow('exited with 1');
  });

  it('rejects unknown ops through the null-def path', async () => {
    // No spawn mock needed: an unknown op returns -1 before any spawning.
    const { runOp } = await import('../../src/agent.js');
    const code = await runOp('nope.nope', {}, () => {});
    expect(code).toBe(-1);
  });

  it('handles responses without a lines array', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const lines: string[] = [];
    const res = await agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.ping', {}, (l) => lines.push(l));
    expect(res).toEqual({ exitCode: 0, lines: [] });
    expect(lines).toEqual([]);
  });

  it('tolerates unreadable error bodies', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.reject(new Error('stream gone')) });
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, () => {}),
    ).rejects.toThrow('agent docker.pull failed (500)');
  });

  it('throws for an unknown server', async () => {
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: undefined } }), 99, 'docker.pull', {}, () => {}),
    ).rejects.toThrow('Unknown server');
  });
});

describe('agentPing', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => undefined);

  it('probes the ping endpoint with the token', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await expect(agentPing('10.0.0.5', 4600, 'tok')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:4600/agent/ping');
    expect((init.headers as Record<string, string>)['x-agent-token']).toBe('tok');
  });

  it('throws when unreachable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    await expect(agentPing('10.0.0.5', 4600, 'tok')).rejects.toThrow('agent unreachable (502)');
  });
});

describe('agent typed-operation table (unit)', () => {
  it('rejects hostile operands before spawning', async () => {
    const spawnMock2 = vi.hoisted(() => vi.fn(async () => 0));
    vi.doMock('../../src/lib/spawnValidated.js', () => ({ spawnValidated: spawnMock2 }));
    const { runOp } = await import('../../src/agent.js');
    await expect(runOp('docker.pull', { image: 'nginx; touch /pwn' }, () => {})).rejects.toThrow('Invalid image');
    await expect(runOp('docker.run', { name: '../escape' }, () => {})).rejects.toThrow('Invalid name');
    vi.doUnmock('../../src/lib/spawnValidated.js');
  });

  it('returns -1 for unknown operations without spawning', async () => {
    const spawnMock3 = vi.hoisted(() => vi.fn(async () => 0));
    vi.doMock('../../src/lib/spawnValidated.js', () => ({ spawnValidated: spawnMock3 }));
    const { runOp } = await import('../../src/agent.js');
    const code = await runOp('bash.exec', {}, () => {});
    expect(code).toBe(-1);
    expect(spawnMock3).not.toHaveBeenCalled();
    vi.doUnmock('../../src/lib/spawnValidated.js');
  });
});
