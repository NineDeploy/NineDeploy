
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetSealedSupportCache, agentOp, agentPing, generateAgentToken, tokenMatches } from '../../src/lib/agentClient.js';
import { open as openSealed, seal } from '../../src/lib/agentSeal.js';
import { runOp } from '../../src/agent.js';
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

/** The shared secret both ends derive the envelope key from: sha256(token). */
const SHARED = cryptoReal.sha256('raw-token');

/**
 * Answer `/agent/ping` with a capability and `/agent/exec` with `exec`.
 * The client probes the agent before an operation to decide whether it may use
 * the sealed transport, so a blanket `mockResolvedValue` would answer the probe
 * with an exec response.
 */
function routeFetch(opts: { sealed: boolean; exec: unknown; pingOk?: boolean }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/agent/ping')) {
      if (opts.pingOk === false) throw new Error('unreachable');
      return { ok: true, json: async () => ({ ok: true, agent: true, sealed: opts.sealed }) };
    }
    return { ok: true, json: async () => opts.exec };
  });
}

describe('agentOp', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    _resetSealedSupportCache();
    delete process.env['NINEDEPLOY_AGENT_REQUIRE_SEALED'];
  });

  it('seals the request so neither the token nor the params cross in cleartext', async () => {
    routeFetch({ sealed: true, exec: { sealed: seal(SHARED, { lines: ['a', 'b'], exitCode: 0 }) } });
    const lines: string[] = [];
    const res = await agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', { image: 'nginx' }, (l) => lines.push(l));
    expect(res).toEqual({ exitCode: 0, lines: ['a', 'b'] });
    expect(lines).toEqual(['a', 'b']);

    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:4600/agent/exec');
    // The whole point: no token header, and the operands are not readable.
    expect((init.headers as Record<string, string>)['x-agent-token']).toBeUndefined();
    const body = String(init.body);
    expect(body).not.toContain('raw-token');
    expect(body).not.toContain('nginx');
    // ...but the agent, holding the same secret, reads them back exactly.
    expect(openSealed(SHARED, JSON.parse(body).sealed)).toEqual({
      op: 'docker.pull',
      params: { image: 'nginx' },
    });
  });

  it('falls back to the legacy transport for an older agent, and says so out loud', async () => {
    routeFetch({ sealed: false, exec: { lines: ['a'], exitCode: 0 } });
    const lines: string[] = [];
    const res = await agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', { image: 'nginx' }, (l) => lines.push(l));
    expect(res).toEqual({ exitCode: 0, lines: ['a'] });
    // The warning reaches the deploy log, naming the host to upgrade.
    expect(lines[0]).toMatch(/older build.*travels unencrypted/);
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-agent-token']).toBe('raw-token');
    expect(JSON.parse(String(init.body))).toEqual({ op: 'docker.pull', params: { image: 'nginx' } });
  });

  it('refuses the cleartext fallback when the operator has forbidden it', async () => {
    // Closes the one downgrade an on-path attacker could force, by stripping
    // `sealed` from the ping response.
    process.env['NINEDEPLOY_AGENT_REQUIRE_SEALED'] = '1';
    routeFetch({ sealed: false, exec: { lines: [], exitCode: 0 } });
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, () => {}),
    ).rejects.toThrow(/REQUIRE_SEALED=1 forbids the cleartext fallback/);
  });

  it('treats an unreachable ping as assume-legacy rather than failing early', async () => {
    routeFetch({ sealed: true, exec: { lines: [], exitCode: 0 }, pingOk: false });
    const lines: string[] = [];
    await agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, (l) => lines.push(l));
    expect(lines[0]).toMatch(/older build/);
  });

  it('probes each server once and reuses the answer', async () => {
    routeFetch({ sealed: true, exec: { sealed: seal(SHARED, { lines: [], exitCode: 0 }) } });
    const db = createFakeDb({ findFirst: { servers: serverRow } });
    await agentOp(db, 1, 'docker.pull', {}, () => {});
    await agentOp(db, 1, 'docker.pull', {}, () => {});
    const pings = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/agent/ping'));
    expect(pings).toHaveLength(1);
  });

  it('re-probes after a failed ping instead of pinning the server to cleartext', async () => {
    // A negative answer we merely failed to obtain must NOT be cached. One
    // dropped probe — an agent restarting, a lost packet, or an on-path
    // attacker killing exactly one request — would otherwise downgrade this
    // server to the plaintext transport for the rest of the process's life,
    // which is a permanent protocol downgrade an attacker gets to choose.
    let pings = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/agent/ping')) {
        pings++;
        if (pings === 1) throw new Error('unreachable');
        return { ok: true, json: async () => ({ ok: true, agent: true, sealed: true }) };
      }
      return { ok: true, json: async () => ({ sealed: seal(SHARED, { lines: [], exitCode: 0 }) }) };
    });
    const db = createFakeDb({ findFirst: { servers: serverRow } });

    const first: string[] = [];
    await agentOp(db, 1, 'docker.pull', {}, (l) => first.push(l));
    expect(first[0]).toMatch(/older build/);

    // Second call probes again and gets the real answer: sealed, no warning.
    const second: string[] = [];
    await agentOp(db, 1, 'docker.pull', {}, (l) => second.push(l));
    expect(second).toEqual([]);
    expect(pings).toBe(2);
  });

  it('does not cache a non-OK ping either', async () => {
    let pings = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/agent/ping')) {
        pings++;
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ lines: [], exitCode: 0 }) };
    });
    const db = createFakeDb({ findFirst: { servers: serverRow } });
    await agentOp(db, 1, 'docker.pull', {}, () => {});
    await agentOp(db, 1, 'docker.pull', {}, () => {});
    expect(pings).toBe(2);
  });

  it('throws on transport errors', async () => {
    routeFetch({ sealed: true, exec: {} });
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, () => {}),
    ).rejects.toThrow('agent docker.pull failed (401)');
  });

  it('throws on non-zero exit codes', async () => {
    routeFetch({ sealed: false, exec: { lines: [], exitCode: 1 } });
    await expect(
      agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.pull', {}, () => {}),
    ).rejects.toThrow('exited with 1');
  });

  it('rejects unknown ops through the null-def path', async () => {
    // No spawn mock needed: an unknown op returns -1 before any spawning.
    const code = await runOp('nope.nope', {}, () => {});
    expect(code).toBe(-1);
  });

  it('handles responses without a lines array', async () => {
    routeFetch({ sealed: true, exec: { sealed: seal(SHARED, {}) } });
    const lines: string[] = [];
    const res = await agentOp(createFakeDb({ findFirst: { servers: serverRow } }), 1, 'docker.ping', {}, (l) => lines.push(l));
    expect(res).toEqual({ exitCode: 0, lines: [] });
    expect(lines).toEqual([]);
  });

  it('tolerates unreadable error bodies', async () => {
    routeFetch({ sealed: true, exec: {} });
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
    const spawnMock2 = vi.fn(async () => 0);
    vi.doMock('../../src/lib/spawnValidated.js', () => ({ spawnValidated: spawnMock2 }));
    const { runOp } = await import('../../src/agent.js');
    await expect(runOp('docker.pull', { image: 'nginx; touch /pwn' }, () => {})).rejects.toThrow('Invalid image');
    await expect(runOp('docker.run', { name: '../escape' }, () => {})).rejects.toThrow('Invalid name');
    vi.doUnmock('../../src/lib/spawnValidated.js');
  });

  it('returns -1 for unknown operations without spawning', async () => {
    const spawnMock3 = vi.fn(async () => 0);
    vi.doMock('../../src/lib/spawnValidated.js', () => ({ spawnValidated: spawnMock3 }));
    const { runOp } = await import('../../src/agent.js');
    const code = await runOp('bash.exec', {}, () => {});
    expect(code).toBe(-1);
    expect(spawnMock3).not.toHaveBeenCalled();
    vi.doUnmock('../../src/lib/spawnValidated.js');
  });
});
