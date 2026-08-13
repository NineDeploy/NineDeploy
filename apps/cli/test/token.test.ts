import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenCreateAction, tokenListAction } from '../src/commands/token.js';

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
    getClient: vi.fn(),
    prompt: vi.fn(),
  };
});

vi.mock('@ninedeploy/sdk', () => ({ NineDeployError: h.NineDeployError }));
vi.mock('../src/client.js', () => ({ getClient: h.getClient }));
vi.mock('../src/prompts.js', () => ({ prompt: h.prompt }));

let logSpy: ReturnType<typeof vi.spyOn>;
let tableSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function clientWithTokens(tokens: { create?: ReturnType<typeof vi.fn>; list?: ReturnType<typeof vi.fn> }) {
  h.getClient.mockReturnValue({ auth: { tokens } });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.prompt.mockResolvedValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tokenCreateAction', () => {
  it('creates a token with the default name and prints the raw token once', async () => {
    const create = vi.fn().mockResolvedValue({ id: 7, name: 'ci', token: 'raw-secret' });
    clientWithTokens({ create });

    await tokenCreateAction();

    expect(h.prompt).toHaveBeenCalledWith('Token name', 'ci');
    expect(create).toHaveBeenCalledWith({ name: 'ci' });
    expect(logSpy).toHaveBeenCalledWith('✓ Token "ci" created (id: 7).');
    expect(logSpy).toHaveBeenCalledWith('  This token is shown ONCE — store it securely:');
    expect(logSpy).toHaveBeenCalledWith('  raw-secret');
    expect(logSpy).toHaveBeenCalledWith('  Use it as: Authorization: Bearer <token>');
    expect(process.exitCode).toBe(0);
  });

  it('uses an explicit token name when provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1, name: 'deploy', token: 's' });
    clientWithTokens({ create });
    h.prompt.mockResolvedValue('deploy');

    await tokenCreateAction();

    expect(create).toHaveBeenCalledWith({ name: 'deploy' });
  });

  it('reports a NineDeployError', async () => {
    const create = vi.fn().mockRejectedValue(new h.NineDeployError(401, 'unauthorized'));
    clientWithTokens({ create });

    await tokenCreateAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Could not create token:', 'unauthorized');
    expect(process.exitCode).toBe(1);
  });

  it('reports a generic Error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('network down'));
    clientWithTokens({ create });

    await tokenCreateAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Could not create token:', 'network down');
    expect(process.exitCode).toBe(1);
  });

  it('reports a non-Error rejection', async () => {
    const create = vi.fn().mockRejectedValue('boom');
    clientWithTokens({ create });

    await tokenCreateAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Could not create token:', 'boom');
    expect(process.exitCode).toBe(1);
  });
});

describe('tokenListAction', () => {
  it('prints a notice when there are no tokens', async () => {
    clientWithTokens({ list: vi.fn().mockResolvedValue([]) });

    await tokenListAction();

    expect(logSpy).toHaveBeenCalledWith('No API tokens.');
    expect(tableSpy).not.toHaveBeenCalled();
  });

  it('tables the tokens, defaulting lastUsed to never', async () => {
    const list = vi.fn().mockResolvedValue([
      { id: 1, name: 'ci', lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'deploy', lastUsedAt: '2026-02-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    clientWithTokens({ list });

    await tokenListAction();

    expect(tableSpy).toHaveBeenCalledWith([
      { id: 1, name: 'ci', lastUsed: 'never', created: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'deploy', lastUsed: '2026-02-01T00:00:00Z', created: '2026-01-01T00:00:00Z' },
    ]);
  });
});
