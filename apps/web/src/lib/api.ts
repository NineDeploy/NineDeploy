import { createClient, type NineDeployClient } from '@ninedeploy/sdk';

const TOKEN_KEY = 'ninedeploy.token';

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

/**
 * Pre-configured SDK client. In development the Vite dev server proxies
 * /health and /v1 to the backend, so same-origin requests "just work".
 */
export const api: NineDeployClient = createClient({
  baseUrl: import.meta.env['VITE_API_URL'] ?? '',
  getToken: () => getToken() ?? undefined,
});

/** Build a WebSocket URL for streaming a deployment's logs (token via query). */
export function deployLogsWsUrl(serviceId: number, deploymentId: number): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getToken() ?? '';
  return `${proto}://${window.location.host}/v1/services/${serviceId}/deploys/${deploymentId}/logs?token=${token}`;
}
