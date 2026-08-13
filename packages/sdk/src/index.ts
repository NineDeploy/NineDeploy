import type {
  ApiToken,
  Attachment,
  CreateApiToken,
  CreateDatabaseInput,
  CreateDomainInput,
  CreateServiceInput,
  CreateWebhookInput,
  CreatedApiToken,
  CreatedWebhook,
  Deployment,
  Domain,
  EnvVar,
  Login,
  ManagedDatabase,
  PublicUser,
  Refresh,
  Register,
  Service,
  Session,
  TriggerDeploy,
  UpdateServiceInput,
  UpsertEnvVarInput,
  Webhook,
} from '@ninedeploy/schemas';
import { NineDeployError } from './errors.js';

export { NineDeployError };
export type * from '@ninedeploy/schemas';

/**
 * Minimal structural fetch type so the SDK is isomorphic (browser + Node)
 * without pulling in DOM lib types. Both `globalThis.fetch` implementations
 * satisfy this shape.
 */
export interface FetchLike {
  (input: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export interface HealthStatus {
  status: string;
  db?: string;
  version?: string;
  time?: string;
}

export interface NineDeployClientOptions {
  /** Base URL of the NineDeploy API, e.g. http://localhost:3000. */
  baseUrl: string;
  /** Returns the current access token (or bearer credential). */
  getToken?: () => string | undefined | null;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: FetchLike;
}

export interface NineDeployClient {
  auth: {
    status: () => Promise<{ initialized: boolean }>;
    setup: (input: Register) => Promise<Session>;
    register: (input: Register) => Promise<Session>;
    login: (input: Login) => Promise<Session>;
    refresh: (input: Refresh) => Promise<Session>;
    me: () => Promise<PublicUser>;
    tokens: {
      create: (input?: CreateApiToken) => Promise<CreatedApiToken>;
      list: () => Promise<ApiToken[]>;
      remove: (id: number) => Promise<void>;
    };
  };
  services: {
    list: () => Promise<Service[]>;
    get: (id: number) => Promise<Service>;
    create: (input: CreateServiceInput) => Promise<Service>;
    update: (id: number, input: UpdateServiceInput) => Promise<Service>;
    remove: (id: number) => Promise<void>;
  };
  deploys: {
    trigger: (serviceId: number, input?: TriggerDeploy) => Promise<{ deploymentId: number }>;
    list: (serviceId: number) => Promise<Deployment[]>;
  };
  domains: {
    list: (serviceId: number) => Promise<Domain[]>;
    create: (serviceId: number, input: CreateDomainInput) => Promise<Domain>;
    remove: (serviceId: number, domainId: number) => Promise<void>;
  };
  webhooks: {
    list: (serviceId: number) => Promise<Webhook[]>;
    create: (serviceId: number, input?: CreateWebhookInput) => Promise<CreatedWebhook>;
    remove: (serviceId: number, hookId: number) => Promise<void>;
  };
  databases: {
    list: () => Promise<ManagedDatabase[]>;
    create: (input: CreateDatabaseInput) => Promise<ManagedDatabase>;
    get: (id: number) => Promise<ManagedDatabase>;
    remove: (id: number) => Promise<void>;
  };
  attachments: {
    list: (serviceId: number) => Promise<Attachment[]>;
    create: (serviceId: number, input: { databaseId: number; envAlias?: string }) => Promise<Attachment>;
    remove: (serviceId: number, attachmentId: number) => Promise<void>;
  };
  env: {
    list: (serviceId: number) => Promise<EnvVar[]>;
    create: (serviceId: number, input: UpsertEnvVarInput) => Promise<EnvVar>;
    update: (serviceId: number, varId: number, input: UpsertEnvVarInput) => Promise<EnvVar>;
    remove: (serviceId: number, varId: number) => Promise<void>;
  };
  health: () => Promise<HealthStatus>;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

const NO_FETCH = (): Promise<never> =>
  Promise.reject(new NineDeployError(0, 'no_fetch', 'No fetch implementation is available'));

/**
 * Create a typed NineDeploy API client. Used by both the web dashboard and the CLI.
 *
 * @example
 * const client = createClient({ baseUrl: 'http://localhost:3000', getToken: () => token });
 * const services = await client.services.list();
 */
export function createClient(opts: NineDeployClientOptions): NineDeployClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const fetchImpl: FetchLike = opts.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch ?? NO_FETCH);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = opts.getToken?.();
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (init.body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);

    const res = await fetchImpl(`${baseUrl}${path}`, { method: init.method ?? 'GET', headers, body });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;

    if (!res.ok) throw NineDeployError.fromBody(res.status, parsed);
    return parsed as T;
  }

  const get = <T>(path: string) => request<T>(path, { method: 'GET' });
  const send = <T>(method: string, path: string, body?: unknown) => request<T>(path, { method, body });

  return {
    auth: {
      status: () => get<{ initialized: boolean }>('/v1/auth/status'),
      setup: (input) => send<Session>('POST', '/v1/setup', input),
      register: (input) => send<Session>('POST', '/v1/auth/register', input),
      login: (input) => send<Session>('POST', '/v1/auth/login', input),
      refresh: (input) => send<Session>('POST', '/v1/auth/refresh', input),
      me: () => get<PublicUser>('/v1/auth/me'),
      tokens: {
        create: (input) => send<CreatedApiToken>('POST', '/v1/auth/tokens', input ?? {}),
        list: () => get<ApiToken[]>('/v1/auth/tokens'),
        remove: async (id) => {
          await request(`/v1/auth/tokens/${id}`, { method: 'DELETE' });
        },
      },
    },
    services: {
      list: () => get<Service[]>('/v1/services'),
      get: (id) => get<Service>(`/v1/services/${id}`),
      create: (input) => send<Service>('POST', '/v1/services', input),
      update: (id, input) => send<Service>('PATCH', `/v1/services/${id}`, input),
      remove: async (id) => {
        await request(`/v1/services/${id}`, { method: 'DELETE' });
      },
    },
    deploys: {
      trigger: (serviceId, input) =>
        send<{ deploymentId: number }>('POST', `/v1/services/${serviceId}/deploys`, input ?? {}),
      list: (serviceId) => get<Deployment[]>(`/v1/services/${serviceId}/deploys`),
    },
    domains: {
      list: (serviceId) => get<Domain[]>(`/v1/services/${serviceId}/domains`),
      create: (serviceId, input) => send<Domain>('POST', `/v1/services/${serviceId}/domains`, input),
      remove: async (serviceId, domainId) => {
        await request(`/v1/services/${serviceId}/domains/${domainId}`, { method: 'DELETE' });
      },
    },
    webhooks: {
      list: (serviceId) => get<Webhook[]>(`/v1/services/${serviceId}/webhooks`),
      create: (serviceId, input) => send<CreatedWebhook>('POST', `/v1/services/${serviceId}/webhooks`, input ?? {}),
      remove: async (serviceId, hookId) => {
        await request(`/v1/services/${serviceId}/webhooks/${hookId}`, { method: 'DELETE' });
      },
    },
    databases: {
      list: () => get<ManagedDatabase[]>('/v1/databases'),
      create: (input) => send<ManagedDatabase>('POST', '/v1/databases', input),
      get: (id) => get<ManagedDatabase>(`/v1/databases/${id}`),
      remove: async (id) => {
        await request(`/v1/databases/${id}`, { method: 'DELETE' });
      },
    },
    attachments: {
      list: (serviceId) => get<Attachment[]>(`/v1/services/${serviceId}/attachments`),
      create: (serviceId, input) => send<Attachment>('POST', `/v1/services/${serviceId}/attachments`, input),
      remove: async (serviceId, attachmentId) => {
        await request(`/v1/services/${serviceId}/attachments/${attachmentId}`, { method: 'DELETE' });
      },
    },
    env: {
      list: (serviceId) => get<EnvVar[]>(`/v1/services/${serviceId}/env`),
      create: (serviceId, input) => send<EnvVar>('POST', `/v1/services/${serviceId}/env`, input),
      update: (serviceId, varId, input) => send<EnvVar>('PATCH', `/v1/services/${serviceId}/env/${varId}`, input),
      remove: async (serviceId, varId) => {
        await request(`/v1/services/${serviceId}/env/${varId}`, { method: 'DELETE' });
      },
    },
    health: () => get<HealthStatus>('/health'),
  };
}
