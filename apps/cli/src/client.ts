import { createClient, type NineDeployClient } from '@ninedeploy/sdk';
import { loadConfig } from './config.js';

/** Build an SDK client configured from the saved CLI config. */
export function getClient(): NineDeployClient {
  const cfg = loadConfig();
  return createClient({
    baseUrl: cfg.baseUrl,
    getToken: () => cfg.token,
  });
}
