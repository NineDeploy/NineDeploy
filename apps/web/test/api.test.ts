import { beforeEach, describe, expect, it, vi } from 'vitest';
import './web-utils.js';

const sdkMock = vi.hoisted(() => ({
  createClient: vi.fn((_opts: {
    baseUrl: string;
    getToken?: () => string | undefined;
    fetch?: typeof fetch;
  }) => ({
    auth: {
      refresh: vi.fn(),
      logout: vi.fn(),
    },
  })),
}));

vi.mock('@ninedeploy/sdk', () => ({ createClient: sdkMock.createClient }));

import {
  api,
  authedFetch,
  clearTokens,
  deployLogsWsUrl,
  execWsUrl,
  getToken,
  refreshAccessToken,
  setSessionTokens,
  setToken,
  websocketAuthProtocols,
} from '../src/lib/api.js';

const TOKEN_KEY = 'ninedeploy.token';
const REFRESH_KEY = 'ninedeploy.refreshToken';

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
  beforeEach(() => sessionStorage.clear());

  it('returns the stored token', () => {
    sessionStorage.setItem(TOKEN_KEY, 'abc123');
    expect(getToken()).toBe('abc123');
  });

  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('returns null when sessionStorage access throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getToken()).toBeNull();
    spy.mockRestore();
  });
});

describe('setToken', () => {
  beforeEach(() => sessionStorage.clear());

  it('stores a token', () => {
    setToken('tok');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok');
  });

  it('removes the token when given null', () => {
    sessionStorage.setItem(TOKEN_KEY, 'old');
    setToken(null);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('removes the token when given empty string', () => {
    sessionStorage.setItem(TOKEN_KEY, 'old');
    setToken('');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
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

  it('treats a denied sessionStorage as empty (SSR / privacy mode)', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      expect(getToken()).toBeNull();
      expect(() => setToken('x')).not.toThrow();
      // A session with only an access token must also survive a denied store.
      expect(() => setSessionTokens('solo')).not.toThrow();
      expect(() => clearTokens()).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(window, 'sessionStorage', descriptor);
    }
  });
});

describe('setSessionTokens without a refresh token', () => {
  beforeEach(() => sessionStorage.clear());

  it('stores the access token and clears any stale refresh token', () => {
    sessionStorage.setItem(REFRESH_KEY, 'stale');
    setSessionTokens('solo');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('solo');
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

describe('api client', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('creates the SDK client with the configured baseUrl and a token reader', () => {
    expect(sdkMock.createClient).toHaveBeenCalledTimes(1);
    const opts = sdkMock.createClient.mock.calls[0]?.[0] as {
      baseUrl: string;
      getToken?: () => string | undefined;
      fetch?: typeof fetch;
    };
    expect(opts.baseUrl).toBe('');
    expect(opts.fetch).toBeTypeOf('function');
    sessionStorage.setItem(TOKEN_KEY, 'tok-1');
    expect(opts.getToken?.()).toBe('tok-1');
    sessionStorage.removeItem(TOKEN_KEY);
    expect(opts.getToken?.()).toBeUndefined();
  });

  it('exports the client created by the SDK factory', () => {
    expect(api).toBeDefined();
  });
});

describe('session token storage', () => {
  beforeEach(() => sessionStorage.clear());

  it('setSessionTokens stores both tokens', () => {
    setSessionTokens('acc', 'ref');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('acc');
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('ref');
  });

  it('clearTokens removes both tokens', () => {
    setSessionTokens('acc', 'ref');
    clearTokens();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('ignores storage failures on write and read of the refresh token', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setSessionTokens('a', 'r')).not.toThrow();
    spy.mockRestore();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    // A denied read surfaces as "no refresh token" → refresh declines safely.
    sessionStorage.setItem(REFRESH_KEY, 'r');
    await expect(refreshAccessToken()).resolves.toBe(false);
    getItem.mockRestore();
  });
});

describe('fetchWithRefresh (401 → refresh → retry)', () => {
  const client = sdkMock.createClient.mock.results[0]!.value as {
    auth: { refresh: ReturnType<typeof vi.fn> };
  };
  const fetchWithRefresh = (sdkMock.createClient.mock.calls[0]![0] as { fetch: typeof fetch }).fetch;
  const status = (code: number) => ({ ok: code < 300, status: code, text: async () => '' }) as Response;

  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    client.auth.refresh.mockReset();
  });

  it('passes non-401 responses straight through', async () => {
    const fetchMock = vi.fn(async () => status(200));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRefresh('/v1/services', { headers: { Authorization: 'Bearer a' } });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('refreshes once and retries with the new access token after a 401', async () => {
    setSessionTokens('expired-acc', 'refresh-1');
    client.auth.refresh.mockResolvedValue({
      user: { id: 1 },
      tokens: { accessToken: 'fresh-acc', refreshToken: 'refresh-2', expiresIn: 900 },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(401)) // original call
      .mockResolvedValueOnce(status(200)); // retry
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRefresh('/v1/services', { headers: { Authorization: 'Bearer expired-acc' } });

    expect(res.status).toBe(200);
    expect(client.auth.refresh).toHaveBeenCalledWith({ refreshToken: 'refresh-1' });
    // The retry carries the refreshed token.
    const retryHeaders = new Headers(fetchMock.mock.calls[1]![1]!.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-acc');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('fresh-acc');
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-2');
    vi.unstubAllGlobals();
  });

  it('never refreshes for auth/setup endpoints (no loops)', async () => {
    setSessionTokens('acc', 'ref');
    const fetchMock = vi.fn(async () => status(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRefresh('/v1/auth/login', {});
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.auth.refresh).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('returns the 401 and clears tokens when the refresh itself fails', async () => {
    setSessionTokens('acc', 'dead-refresh');
    client.auth.refresh.mockRejectedValue(new Error('401'));
    const fetchMock = vi.fn(async () => status(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRefresh('/v1/services', {});
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns the 401 without refreshing when no refresh token is stored', async () => {
    const fetchMock = vi.fn(async () => status(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRefresh('/v1/services', {});
    expect(res.status).toBe(401);
    expect(client.auth.refresh).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shares a single in-flight refresh across concurrent 401s', async () => {
    setSessionTokens('acc', 'ref');
    let resolveRefresh!: (v: unknown) => void;
    client.auth.refresh.mockReturnValue(
      new Promise((r) => {
        resolveRefresh = r;
      }),
    );
    // Two 401s racing; the refresh resolves both retries together.
    const fetchMock = vi.fn(async () => status(401));
    vi.stubGlobal('fetch', fetchMock);

    const p1 = fetchWithRefresh('/v1/services', {});
    const p2 = fetchWithRefresh('/v1/users', {});
    await new Promise((r) => setTimeout(r, 0));
    resolveRefresh({
      tokens: { accessToken: 'fresh', refreshToken: 'ref2', expiresIn: 900 },
    });
    await Promise.all([p1, p2]);

    expect(client.auth.refresh).toHaveBeenCalledTimes(1); // single-flight
    vi.unstubAllGlobals();
  });

  it('handles URL and Request inputs for the endpoint match', async () => {
    // 401 so the URL-resolution line runs; no refresh token stored → returns as-is.
    const fetchMock = vi.fn(async () => status(401));
    vi.stubGlobal('fetch', fetchMock);
    const viaUrl = await fetchWithRefresh(new URL('http://api.test/v1/services'), {});
    expect(viaUrl.status).toBe(401);
    const viaRequest = await fetchWithRefresh(new Request('http://api.test/v1/services'), {});
    expect(viaRequest.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.auth.refresh).not.toHaveBeenCalled(); // no refresh token stored
    vi.unstubAllGlobals();
  });

  it('retries with no original headers when init was omitted', async () => {
    setSessionTokens('acc', 'ref');
    client.auth.refresh.mockResolvedValue({
      tokens: { accessToken: 'fresh', refreshToken: 'ref2', expiresIn: 900 },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(401))
      .mockResolvedValueOnce(status(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRefresh('/v1/services', {});
    expect(res.status).toBe(200);
    const retryHeaders = new Headers(fetchMock.mock.calls[1]![1]!.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh');
    vi.unstubAllGlobals();
  });

  it('exposes refreshAccessToken for explicit refreshes', async () => {
    setSessionTokens('acc', 'ref');
    client.auth.refresh.mockResolvedValue({
      tokens: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 },
    });
    await expect(refreshAccessToken()).resolves.toBe(true);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('a2');
  });
});

describe('authedFetch', () => {
  const client = sdkMock.createClient.mock.results[0]!.value as {
    auth: { refresh: ReturnType<typeof vi.fn> };
  };
  const status = (code: number) => ({ ok: code < 300, status: code, text: async () => '' }) as Response;

  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    client.auth.refresh.mockReset();
  });

  it('sends the stored access token as a bearer header', async () => {
    setToken('tok-9');
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => status(200));
    vi.stubGlobal('fetch', fetchMock);
    const res = await authedFetch('/v1/services/1/export');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get('Authorization')).toBe('Bearer tok-9');
    vi.unstubAllGlobals();
  });

  it('omits the authorization header when no token is stored', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => status(200));
    vi.stubGlobal('fetch', fetchMock);
    const res = await authedFetch('/v1/services/1/export', { headers: { Accept: 'application/json' } });
    expect(res.status).toBe(200);
    // Existing headers are preserved; no Authorization is added.
    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Accept')).toBe('application/json');
    vi.unstubAllGlobals();
  });

  it('delegates to fetchWithRefresh: a 401 triggers a refresh and retry', async () => {
    setSessionTokens('stale-acc', 'refresh-1');
    client.auth.refresh.mockResolvedValue({
      user: { id: 1 },
      tokens: { accessToken: 'fresh-acc', refreshToken: 'refresh-2', expiresIn: 900 },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(status(401)) // original call with the stale token
      .mockResolvedValueOnce(status(200)); // retry with the refreshed token
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('/v1/services/1/export');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.auth.refresh).toHaveBeenCalledWith({ refreshToken: 'refresh-1' });
    const retryHeaders = new Headers(fetchMock.mock.calls[1]![1]!.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-acc');
    vi.unstubAllGlobals();
  });
});

describe('deployLogsWsUrl', () => {
  beforeEach(() => sessionStorage.clear());

  it('builds a credential-free ws:// URL and puts the token in a subprotocol', () => {
    sessionStorage.setItem(TOKEN_KEY, 'sec');
    expect(deployLogsWsUrl(7, 42)).toBe('ws://localhost/v1/services/7/deploys/42/logs');
    expect(websocketAuthProtocols()).toEqual(['ninedeploy.bearer.sec']);
  });

  it('uses an empty token when none is stored', () => {
    expect(deployLogsWsUrl(7, 42)).toBe('ws://localhost/v1/services/7/deploys/42/logs');
    expect(websocketAuthProtocols()).toEqual(['ninedeploy']);
  });

  it('builds a wss:// URL on an https origin', () => {
    withWindowLocation({ protocol: 'https:', host: 'panel.example.com' }, () => {
      expect(deployLogsWsUrl(3, 9)).toBe(
        'wss://panel.example.com/v1/services/3/deploys/9/logs',
      );
    });
  });

  it('builds the exec terminal URL from the current origin', () => {
    expect(execWsUrl(1)).toBe('ws://localhost/v1/services/1/exec');
    withWindowLocation({ protocol: 'https:', host: 'panel.example.com' }, () => {
      expect(execWsUrl(2)).toBe('wss://panel.example.com/v1/services/2/exec');
    });
  });

  it('derives WebSocket hosts from VITE_API_URL when configured', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
    try {
      expect(deployLogsWsUrl(7, 42)).toBe('wss://api.example.com/v1/services/7/deploys/42/logs');
      expect(execWsUrl(1)).toBe('wss://api.example.com/v1/services/1/exec');
      // An http API URL downgrades to plain ws.
      vi.stubEnv('VITE_API_URL', 'http://api.local:8080');
      expect(deployLogsWsUrl(7, 42)).toBe('ws://api.local:8080/v1/services/7/deploys/42/logs');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
