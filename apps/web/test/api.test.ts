import { beforeEach, describe, expect, it, vi } from 'vitest';
import './web-utils.js';

const sdkMock = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));

vi.mock('@ninedeploy/sdk', () => ({ createClient: sdkMock.createClient }));

import { api, deployLogsWsUrl, getToken, setToken } from '../src/lib/api.js';

const TOKEN_KEY = 'ninedeploy.token';

/** Temporarily replace the global window so code under test sees a custom location. */
function withWindowLocation(location: { protocol: string; host: string }, fn: () => void): void {
  const realWindow = globalThis.window;
  vi.stubGlobal('window', { location } as unknown as Window);
  try {
    fn();
  } finally {
    vi.stubGlobal('window', realWindow);
  }
}

describe('getToken', () => {
  beforeEach(() => localStorage.clear());

  it('returns the stored token', () => {
    localStorage.setItem(TOKEN_KEY, 'abc123');
    expect(getToken()).toBe('abc123');
  });

  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('returns null when localStorage access throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getToken()).toBeNull();
    spy.mockRestore();
  });
});

describe('setToken', () => {
  beforeEach(() => localStorage.clear());

  it('stores a token', () => {
    setToken('tok');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
  });

  it('removes the token when given null', () => {
    localStorage.setItem(TOKEN_KEY, 'old');
    setToken(null);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('removes the token when given empty string', () => {
    localStorage.setItem(TOKEN_KEY, 'old');
    setToken('');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('ignores failures when storing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setToken('tok')).not.toThrow();
    spy.mockRestore();
  });

  it('ignores failures when removing', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setToken(null)).not.toThrow();
    spy.mockRestore();
  });
});

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates the SDK client with the configured baseUrl and a token reader', () => {
    expect(sdkMock.createClient).toHaveBeenCalledTimes(1);
    const opts = sdkMock.createClient.mock.calls[0]?.[0] as {
      baseUrl: string;
      getToken?: () => string | undefined;
    };
    expect(opts.baseUrl).toBe('');
    localStorage.setItem(TOKEN_KEY, 'tok-1');
    expect(opts.getToken?.()).toBe('tok-1');
    localStorage.removeItem(TOKEN_KEY);
    expect(opts.getToken?.()).toBeUndefined();
  });

  it('exports the client created by the SDK factory', () => {
    expect(api).toBeDefined();
  });
});

describe('deployLogsWsUrl', () => {
  beforeEach(() => localStorage.clear());

  it('builds a ws:// URL on an http origin, embedding the token', () => {
    localStorage.setItem(TOKEN_KEY, 'sec');
    expect(deployLogsWsUrl(7, 42)).toBe(
      'ws://localhost/v1/services/7/deploys/42/logs?token=sec',
    );
  });

  it('uses an empty token when none is stored', () => {
    expect(deployLogsWsUrl(7, 42)).toBe(
      'ws://localhost/v1/services/7/deploys/42/logs?token=',
    );
  });

  it('builds a wss:// URL on an https origin', () => {
    withWindowLocation({ protocol: 'https:', host: 'panel.example.com' }, () => {
      expect(deployLogsWsUrl(3, 9)).toBe(
        'wss://panel.example.com/v1/services/3/deploys/9/logs?token=',
      );
    });
  });
});
