import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../src/client.js';

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('@ninedeploy/sdk', () => ({ createClient: h.createClient }));
vi.mock('../src/config.js', () => ({ loadConfig: h.loadConfig }));

beforeEach(() => {
  vi.clearAllMocks();
  h.createClient.mockImplementation(
    (opts: { baseUrl: string; getToken: () => string | undefined }) => ({
      baseUrl: opts.baseUrl,
      getToken: opts.getToken,
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getClient', () => {
  it('builds a client from the saved config', () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://srv:3000', token: 'abc' });

    const client = getClient();

    expect(h.loadConfig).toHaveBeenCalledOnce();
    expect(h.createClient).toHaveBeenCalledOnce();
    const opts = h.createClient.mock.calls[0]?.[0];
    expect(opts?.baseUrl).toBe('http://srv:3000');
    expect(opts?.getToken()).toBe('abc');
    expect(client).toBeDefined();
  });

  it('allows a config without a token', () => {
    h.loadConfig.mockReturnValue({ baseUrl: 'http://srv:3000' });

    getClient();

    const opts = h.createClient.mock.calls[0]?.[0];
    expect(opts?.baseUrl).toBe('http://srv:3000');
    expect(opts?.getToken()).toBeUndefined();
  });
});
