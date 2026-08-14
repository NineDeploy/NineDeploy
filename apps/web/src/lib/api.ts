import { createClient, type NineDeployClient } from '@ninedeploy/sdk';

const TOKEN_KEY = 'ninedeploy.token';
const REFRESH_KEY = 'ninedeploy.refreshToken';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore (SSR / privacy mode) */
  }
}

function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function setRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

/** Persist both tokens of a session (access + refresh). */
export function setSessionTokens(accessToken: string, refreshToken: string): void {
  setToken(accessToken);
  setRefreshToken(refreshToken);
}

/** Clear every stored credential (logout / failed refresh). */
export function clearTokens(): void {
  setToken(null);
  setRefreshToken(null);
}

/** The raw underlying fetch (the interceptor below wraps it). */
const baseFetch: typeof fetch = (...args) => fetch(...args);

/**
 * Single-flight access-token refresh. A 15-minute access token otherwise logs
 * the user out mid-session; when it expires, this exchanges the stored refresh
 * token for a new pair. Concurrent 401s share one refresh call (no races, no
 * token-version bumps burning each other).
 */
let refreshInflight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const session = await api.auth.refresh({ refreshToken });
    setSessionTokens(session.tokens.accessToken, session.tokens.refreshToken);
    return true;
  } catch {
    clearTokens(); // refresh rejected — the session is gone server-side
    return false;
  }
}

export function refreshAccessToken(): Promise<boolean> {
  refreshInflight ??= doRefresh().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

/**
 * Fetch wrapper: on a 401 from a non-auth endpoint, refresh the access token
 * once and retry. Auth endpoints manage tokens themselves and must not loop.
 */
const fetchWithRefresh: typeof fetch = async (input, init) => {
  const res = await baseFetch(input, init);
  if (res.status !== 401) return res;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/auth/') || url.includes('/v1/setup')) return res;
  if (!(await refreshAccessToken())) return res;
  const headers = new Headers(init?.headers);
  // The refresh just stored a fresh access token, so it is present.
  headers.set('Authorization', `Bearer ${getToken() as string}`);
  return baseFetch(input, { ...init, headers });
};

/**
 * Pre-configured SDK client. In development the Vite dev server proxies
 * /health and /v1 to the backend, so same-origin requests "just work".
 */
export const api: NineDeployClient = createClient({
  baseUrl: import.meta.env['VITE_API_URL'] ?? '',
  getToken: () => getToken() ?? undefined,
  fetch: fetchWithRefresh,
});

/** Build a WebSocket URL for streaming a deployment's logs (token via query). */
export function deployLogsWsUrl(serviceId: number, deploymentId: number): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getToken() ?? '';
  return `${proto}://${window.location.host}/v1/services/${serviceId}/deploys/${deploymentId}/logs?token=${token}`;
}
