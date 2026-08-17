import type {
  ActiveSession,
  ActivityEntry,
  AlertRule,
  CreateAlertRuleInput,
  ApiToken,
  PasskeyCredential,
  Attachment,
  Backup,
  BackupWithDb,
  CreateApiToken,
  CreateDatabaseInput,
  CreateDomainInput,
  CreateProjectInput,
  CreateServiceInput,
  CreateSourceInput,
  CreateTunnelInput,
  CreateWebhookInput,
  CreatedApiToken,
  CreatedWebhook,
  Deployment,
  DockerResources,
  Domain,
  DomainEntry,
  EnvVar,
  Login,
  ManagedDatabase,
  PasswordChange,
  PasswordReset,
  MetricSeries,
  ProjectEntry,
  ProjectPatchInput,
  PublicUser,
  Refresh,
  Register,
  Service,
  Session,
  SetLimitsInput,
  Source,
  StatsSnapshot,
  Template,
  TemplateSummary,
  TopologyGraph,
  TraefikCertificate,
  TraefikInfo,
  TraefikStatus,
  TunnelEntry,
  UserCreate,
  VolumeFileEntry,
  VolumeFileWriteInput,
  VolumePathCreateInput,
  TriggerDeploy,
  UpdateCheckResult,
  UpdateServiceInput,
  UpsertEnvVarInput,
  VolumeEntry,
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
export type FetchLike = (input: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

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
    logout: () => Promise<{ ok: boolean }>;
    /** Self-service password change; revokes other sessions, returns a fresh token pair. */
    changePassword: (input: PasswordChange) => Promise<Session>;
    /** Request a reset link (always 200 — no user enumeration). */
    forgotPassword: (email: string) => Promise<{ ok: boolean }>;
    /** Complete a reset with a single-use token; revokes all sessions. */
    resetPasswordWithToken: (input: { token: string; newPassword: string }) => Promise<{ ok: boolean }>;
    twoFactor: {
      /** Generate a pending secret + otpauth URI (auth required). */
      setup: (input?: { password: string }) => Promise<{ secret: string; otpauthUri: string }>;
      enable: (code: string) => Promise<{ ok: boolean; totpEnabled: boolean }>;
      disable: (input: { password: string; code: string }) => Promise<{ ok: boolean; totpEnabled: boolean }>;
    };
    me: () => Promise<PublicUser>;
    tokens: {
      create: (input?: CreateApiToken) => Promise<CreatedApiToken>;
      list: () => Promise<ApiToken[]>;
      remove: (id: number) => Promise<void>;
    };
    passkeys: {
      /** Start a registration ceremony (returns JSON options for the browser API). */
      registerOptions: () => Promise<{ options: string }>;
      /** Complete registration: verify the browser response, store the credential. */
      registerVerify: (input: { name: string; response: unknown }) => Promise<PasskeyCredential>;
      list: () => Promise<PasskeyCredential[]>;
      remove: (id: number) => Promise<void>;
      /** Start a passwordless login ceremony (discoverable credentials). */
      loginOptions: () => Promise<{ options: string }>;
      /** Complete passkey login — returns a full session on success. */
      loginVerify: (response: unknown) => Promise<Session>;
    };
    sessions: {
      list: () => Promise<ActiveSession[]>;
      revoke: (id: number) => Promise<{ ok: boolean }>;
    };
  };
  services: {
    /** `query` is appended verbatim, e.g. `?projectId=3` (project scoping). */
    list: (query?: string) => Promise<Service[]>;
    get: (id: number) => Promise<Service>;
    create: (input: CreateServiceInput) => Promise<Service>;
    update: (id: number, input: UpdateServiceInput) => Promise<Service>;
    remove: (id: number) => Promise<void>;
    stop: (id: number) => Promise<{ ok: boolean; status: string }>;
    start: (id: number) => Promise<{ ok: boolean; status: string }>;
    restart: (id: number) => Promise<{ ok: boolean; status: string }>;
    logs: (id: number) => Promise<{ lines: string }>;
    exportUrl: (id: number) => string;
    importBundle: (bundle: unknown) => Promise<{ ok: boolean; serviceId: number; slug: string; message: string }>;
  };
  deploys: {
    trigger: (serviceId: number, input?: TriggerDeploy) => Promise<{ deploymentId: number }>;
    list: (serviceId: number) => Promise<Deployment[]>;
    rollback: (serviceId: number, deploymentId: number) => Promise<{ deploymentId: number }>;
    /** Cancel a queued/in-flight deployment (checkpoints abort at step boundaries). */
    cancel: (serviceId: number, deploymentId: number) => Promise<{ ok: boolean; status: string }>;
    /** Build-config + env-key diff against the previous deployment. */
    configDiff: (serviceId: number, deploymentId: number) => Promise<{ deploymentId: number; previousDeploymentId: number | null; changed: boolean; diff: string }>;
  };
  domains: {
    list: (serviceId: number) => Promise<Domain[]>;
    create: (serviceId: number, input: CreateDomainInput) => Promise<Domain>;
    remove: (serviceId: number, domainId: number) => Promise<void>;
    /** Update routing extras: ssl toggle, www→apex redirect, custom headers. */
    update: (serviceId: number, domainId: number, input: { ssl?: boolean; redirectWww?: boolean; headers?: string }) => Promise<Domain>;
    all: () => Promise<DomainEntry[]>;
    setSsl: (domainId: number, ssl: boolean) => Promise<{ id: number; ssl: boolean }>;
  };
  volumes: {
    list: () => Promise<VolumeEntry[]>;
    remove: (name: string) => Promise<void>;
    prune: () => Promise<{ ok: boolean; deleted: number; freedBytes: number }>;
    /** File manager: list a directory inside the volume. */
    listFiles: (name: string, path?: string) => Promise<{ path: string; entries: VolumeFileEntry[] }>;
    /** File manager: read a file (base64 content). */
    readFile: (name: string, path: string) => Promise<{ content: string; encoding: 'utf8' | 'base64' }>;
    /** File manager: write/overwrite a file (base64 content). */
    writeFile: (name: string, input: VolumeFileWriteInput) => Promise<{ ok: boolean }>;
    /** File manager: create a directory. */
    mkdir: (name: string, input: VolumePathCreateInput) => Promise<{ ok: boolean }>;
    /** File manager: delete a file or directory (recursive). */
    deleteFile: (name: string, path: string) => Promise<void>;
  };
  system: {
    resources: () => Promise<DockerResources>;
    pruneImages: () => Promise<{ ok: boolean }>;
    exportUrl: () => string;
    /** Latest-release check (admin). updateAvailable is null when offline/disabled. */
    updateCheck: (force?: boolean) => Promise<UpdateCheckResult>;
    /** Recent docker daemon events (single-shot, for the Docker dashboard feed). */
    dockerEvents: (minutes?: number) => Promise<{ events: Array<{ time: string; type: string; action: string; name: string }> }>;
  };
  networks: {
    list: () => Promise<{ networks: Array<{ name: string; driver: string; members: string[] }>; remote: number | null }>;
    create: (input: { name: string; driver?: 'bridge' | 'overlay'; serverId?: number | null }) => Promise<{ ok: boolean; name: string }>;
    remove: (name: string, serverId?: number) => Promise<{ ok: boolean }>;
    attach: (input: { network: string; container: string; serverId?: number | null }) => Promise<{ ok: boolean }>;
    detach: (input: { network: string; container: string; serverId?: number | null }) => Promise<{ ok: boolean }>;
  };
  tunnels: {
    list: () => Promise<TunnelEntry[]>;
    create: (input: CreateTunnelInput) => Promise<TunnelEntry>;
    remove: (id: number) => Promise<void>;
  };
  activity: {
    /** Filter + paginate the audit trail. Omitted filters return the newest page. */
    list: (query?: { entity?: string; action?: string; userId?: number; before?: number }) => Promise<{ entries: ActivityEntry[]; nextCursor: number | null }>;
  };
  alerts: {
    list: () => Promise<AlertRule[]>;
    create: (input: CreateAlertRuleInput) => Promise<AlertRule>;
    update: (id: number, input: Partial<CreateAlertRuleInput>) => Promise<AlertRule>;
    remove: (id: number) => Promise<void>;
  };
  settings: {
    get: () => Promise<{ allowRegistration: boolean; acmeEmail: string | null; templatesSource: string | null; dnsProvider: string | null; hasDnsToken: boolean; wildcardApex: string | null }>;
    setAllowRegistration: (enabled: boolean) => Promise<{ ok: boolean; allowRegistration: boolean }>;
    setAcmeEmail: (email: string) => Promise<{ ok: boolean; acmeEmail: string | null; applied: string }>;
    setTemplatesSource: (source: string) => Promise<{ ok: boolean; templatesSource: string | null }>;
    /** Configure the ACME DNS-01 challenge (wildcard certificates). */
    setDns: (input: { provider: string; token?: string; wildcardApex: string }) => Promise<{ ok: boolean; dnsProvider: string | null; wildcardApex: string | null; applied: string }>;
    /** Vault provider (deploy-time secret resolution). */
    vault: {
      get: () => Promise<{ provider: string | null; hasToken: boolean; projectId: string | null; environment: string | null }>;
      set: (input: { provider: '' | 'infisical' | 'doppler'; token?: string; projectId?: string; environment?: string }) => Promise<{ ok: boolean; provider: string | null }>;
      test: () => Promise<{ ok: boolean; secrets: number }>;
    };
    /** Cloudflare DNS-record auto-provisioning for added domains. */
    dnsRecords: {
      get: () => Promise<{ enabled: boolean; hasToken: boolean; content: string | null }>;
      set: (input: { enabled: boolean; token?: string; content?: string }) => Promise<{ ok: boolean; enabled: boolean }>;
      test: () => Promise<{ ok: boolean; status?: string; error?: string }>;
    };
  };
  users: {
    list: () => Promise<PublicUser[]>;
    /** Admin-only: create a user directly (no registration flow needed). */
    create: (input: UserCreate) => Promise<PublicUser>;
    setRole: (id: number, role: 'admin' | 'member') => Promise<PublicUser>;
    remove: (id: number) => Promise<void>;
    /** Admin reset of another user's password (revokes their sessions). */
    resetPassword: (id: number, input: PasswordReset) => Promise<{ ok: boolean }>;
    /** Mint a one-time reset link for a user (returned exactly once). */
    resetLink: (id: number) => Promise<{ url: string; expiresAt: string }>;
  };
  projects: {
    list: () => Promise<ProjectEntry[]>;
    create: (input: CreateProjectInput) => Promise<ProjectEntry>;
    update: (id: number, input: ProjectPatchInput) => Promise<ProjectEntry>;
    remove: (id: number) => Promise<{ ok: boolean }>;
  };
  about: {
    get: () => Promise<{
      name: string; version: string; description: string; license: string; repo: string; docs: string;
      techStack: Array<{ category: string; items: string[] }>;
      changelog: Array<{ version: string; date: string; title: string; changes: string[] }>;
      /** Instance counts are only returned for authenticated requests. */
      stats?: { services: number; databases: number; deployments: number; users: number };
    }>;
  };
  notifications: {
    listChannels: () => Promise<Array<{ id: number; name: string; type: string; eventFilter: string; active: boolean; createdAt: string }>>;
    createChannel: (input: { name: string; type: string; target: string; eventFilter?: string }) => Promise<{ id: number; name: string; type: string }>;
    updateChannel: (id: number, input: { name?: string; target?: string; eventFilter?: string; active?: boolean }) => Promise<{ id: number; active: boolean }>;
    removeChannel: (id: number) => Promise<void>;
    testChannel: (id: number) => Promise<{ ok: boolean }>;
    log: () => Promise<Array<{ id: number; channelId: number | null; event: string; entity: string | null; status: string; error: string | null; ts: string }>>;
  };
  sources: {
    list: () => Promise<Source[]>;
    create: (input: CreateSourceInput) => Promise<Source>;
    update: (id: number, input: Partial<CreateSourceInput>) => Promise<Source>;
    remove: (id: number) => Promise<void>;
  };
  webhooks: {
    list: (serviceId: number) => Promise<Webhook[]>;
    create: (serviceId: number, input?: CreateWebhookInput) => Promise<CreatedWebhook>;
    remove: (serviceId: number, hookId: number) => Promise<void>;
  };
  databases: {
    /** `query` is appended verbatim, e.g. `?projectId=3` (project scoping). */
    list: (query?: string) => Promise<ManagedDatabase[]>;
    create: (input: CreateDatabaseInput) => Promise<ManagedDatabase>;
    get: (id: number) => Promise<ManagedDatabase>;
    remove: (id: number, options?: { force?: boolean }) => Promise<void>;
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
    /** Cross-scope key search: where a given env key is defined. */
    search: (q: string) => Promise<{ results: Array<{ key: string; isSecret: boolean; scope: string; serviceId: number | null; serviceName: string | null }> }>;
  };
  projectEnv: {
    /** Shared env vars applied to every service in a project (service env wins). */
    list: (projectId: number) => Promise<EnvVar[]>;
    create: (projectId: number, input: UpsertEnvVarInput) => Promise<EnvVar>;
    update: (projectId: number, varId: number, input: UpsertEnvVarInput) => Promise<EnvVar>;
    remove: (projectId: number, varId: number) => Promise<void>;
  };
  stats: {
    snapshot: () => Promise<StatsSnapshot>;
    metrics: (serviceId: number, opts?: { kind?: 'cpu' | 'memory'; minutes?: number }) => Promise<MetricSeries>;
  };
  dashboard: {
    get: () => Promise<{
      stats: { services: number; databases: number; deployments: number; domains: number; webhooks: number; running: number; stopped: number; errored: number; dbRunning: number; containers: number };
      health: Array<{ serviceId: number; name: string; slug: string; type: string; status: string; healthy: boolean; responseMs: number | null; port: number | null; runtimeId: string | null; commitSha: string | null; lastDeploy: string | null }>;
      recentDeploys: Array<{ id: number; serviceId: number; serviceName: string; status: string; commitSha: string | null; message: string | null; trigger: string; finishedAt: string | null; createdAt: string }>;
    }>;
  };
  topology: {
    get: () => Promise<TopologyGraph>;
  };
  backups: {
    storage: (databaseId: number) => Promise<{ sizeBytes: number }>;
    backupNow: (databaseId: number) => Promise<Backup>;
    listForDb: (databaseId: number) => Promise<Backup[]>;
    restore: (databaseId: number, backupId: number) => Promise<{ ok: boolean }>;
    list: () => Promise<BackupWithDb[]>;
    remove: (backupId: number) => Promise<void>;
    downloadUrl: (backupId: number) => string;
  };
  backupDestinations: {
    list: () => Promise<Array<{ id: number; name: string; endpoint: string; region: string; bucket: string; prefix: string; active: boolean; createdAt: string }>>;
    create: (input: { name: string; endpoint: string; region?: string; bucket: string; prefix?: string; accessKeyId: string; secretAccessKey: string }) => Promise<{ id: number }>;
    update: (id: number, input: Partial<{ name: string; endpoint: string; region: string; bucket: string; prefix: string; active: boolean; accessKeyId: string; secretAccessKey: string }>) => Promise<{ ok: boolean }>;
    remove: (id: number) => Promise<{ ok: boolean }>;
    test: (id: number) => Promise<{ ok: boolean }>;
  };
  jobs: {
    list: (serviceId: number) => Promise<Array<{ id: number; name: string; cron: string; kind: 'deploy' | 'exec'; command: string; enabled: boolean; lastRunAt: string | null }>>;
    create: (serviceId: number, input: { name: string; cron: string; kind: 'deploy' | 'exec'; command?: string; enabled?: boolean }) => Promise<{ id: number }>;
    update: (serviceId: number, jobId: number, input: Partial<{ name: string; cron: string; kind: 'deploy' | 'exec'; command: string; enabled: boolean }>) => Promise<{ ok: boolean }>;
    remove: (serviceId: number, jobId: number) => Promise<{ ok: boolean }>;
    run: (serviceId: number, jobId: number) => Promise<{ ok: boolean }>;
    runs: (serviceId: number, jobId: number) => Promise<Array<{ id: number; status: string; output: string; exitCode: number | null; createdAt: string }>>;
  };
  servers: {
    list: () => Promise<Array<{ id: number; name: string; host: string; port: number; status: string; lastSeenAt: string | null }>>;
    /** Register a server — the agent token + its sha256 are returned exactly once. */
    create: (input: { name: string; host: string; port?: number }) => Promise<{ id: number; token: string; tokenSha256: string; agentCommand: string }>;
    remove: (id: number, options?: { force?: boolean }) => Promise<{ ok: boolean }>;
    test: (id: number) => Promise<{ ok: boolean; status: string }>;
    approve: (id: number) => Promise<{ ok: boolean; status: string }>;
    reject: (id: number) => Promise<{ ok: boolean }>;
  };
  templates: {
    list: () => Promise<TemplateSummary[]>;
    get: (id: string) => Promise<Template>;
    deploy: (id: string) => Promise<{ serviceId: number; deploymentId: number }>;
  };
  limits: {
    setService: (serviceId: number, input: SetLimitsInput) => Promise<{ cpuShares: number; memLimitMb: number }>;
    setDatabase: (databaseId: number, input: SetLimitsInput) => Promise<{ cpuShares: number; memLimitMb: number }>;
  };
  traefik: {
    get: () => Promise<TraefikInfo>;
    status: () => Promise<TraefikStatus>;
    certificates: () => Promise<TraefikCertificate[]>;
    logs: (lines?: number) => Promise<{ logs: string[] }>;
    restart: () => Promise<{ ok: boolean; message?: string }>;
    backupCerts: () => Promise<{ ok: boolean; message?: string; filename?: string }>;
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
    // Guard the parse: proxies (HTML 502 pages, empty bodies) must surface as a
    // typed error, not an opaque SyntaxError.
    let parsed: unknown;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      if (parsed === undefined) throw new NineDeployError(res.status, 'http_error', `Request failed (${res.status})`);
      throw NineDeployError.fromBody(res.status, parsed);
    }
    // An ok response with an empty/unparseable body (204s, HTML pages from a
    // misconfigured proxy) must never resolve to `undefined` — query functions
    // built on this client would crash TanStack Query ("Query data cannot be
    // undefined"). Empty 2xx bodies resolve to {}; non-JSON bodies surface as
    // a typed error so callers see the real problem instead of a crash.
    if (parsed === undefined) {
      if (text === '') return {} as T;
      throw new NineDeployError(res.status, 'invalid_response', `Expected JSON but received a non-JSON body (status ${res.status})`);
    }
    return parsed as T;
  }

  const get = <T>(path: string) => request<T>(path);
  const send = <T>(method: string, path: string, body?: unknown) => request<T>(path, { method, body });

  return {
    auth: {
      status: () => get<{ initialized: boolean }>('/v1/auth/status'),
      setup: (input) => send<Session>('POST', '/v1/setup', input),
      register: (input) => send<Session>('POST', '/v1/auth/register', input),
      login: (input) => send<Session>('POST', '/v1/auth/login', input),
      refresh: (input) => send<Session>('POST', '/v1/auth/refresh', input),
      /** Revoke this user's outstanding JWTs server-side (tokenVersion bump). */
      logout: () => send<{ ok: boolean }>('POST', '/v1/auth/logout', {}),
      changePassword: (input) => send<Session>('POST', '/v1/auth/password', input),
      forgotPassword: (email) => send<{ ok: boolean }>('POST', '/v1/auth/forgot-password', { email }),
      resetPasswordWithToken: (input) => send<{ ok: boolean }>('POST', '/v1/auth/reset-password', input),
      twoFactor: {
        setup: (input?: { password: string }) => send<{ secret: string; otpauthUri: string }>('POST', '/v1/auth/2fa/setup', input ?? {}),
        enable: (code) => send<{ ok: boolean; totpEnabled: boolean }>('POST', '/v1/auth/2fa/enable', { code }),
        disable: (input) => send<{ ok: boolean; totpEnabled: boolean }>('POST', '/v1/auth/2fa/disable', input),
      },
      me: () => get<PublicUser>('/v1/auth/me'),
      tokens: {
        create: (input) => send<CreatedApiToken>('POST', '/v1/auth/tokens', input ?? {}),
        list: () => get<ApiToken[]>('/v1/auth/tokens'),
        remove: async (id) => {
          await request(`/v1/auth/tokens/${id}`, { method: 'DELETE' });
        },
      },
      passkeys: {
        registerOptions: () => send<{ options: string }>('POST', '/v1/auth/passkey/register/options'),
        registerVerify: (input) =>
          send<PasskeyCredential>('POST', '/v1/auth/passkey/register/verify', {
            name: input.name,
            response: input.response as Record<string, unknown>,
          }),
        list: () => get<PasskeyCredential[]>('/v1/auth/passkey'),
        remove: async (id) => {
          await request(`/v1/auth/passkey/${id}`, { method: 'DELETE' });
        },
        loginOptions: () => send<{ options: string }>('POST', '/v1/auth/passkey/login/options'),
        loginVerify: (response) =>
          send<Session>('POST', '/v1/auth/passkey/login/verify', { response: response as Record<string, unknown> }),
      },
      sessions: {
        list: () => get<ActiveSession[]>('/v1/auth/sessions'),
        revoke: (id) => send<{ ok: boolean }>('DELETE', `/v1/auth/sessions/${id}`),
      },
    },
    services: {
      list: (query) => get<Service[]>(`/v1/services${query ?? ''}`),
      get: (id) => get<Service>(`/v1/services/${id}`),
      create: (input) => send<Service>('POST', '/v1/services', input),
      update: (id, input) => send<Service>('PATCH', `/v1/services/${id}`, input),
      remove: async (id) => {
        await request(`/v1/services/${id}`, { method: 'DELETE' });
      },
      stop: (id) => send<{ ok: boolean; status: string }>('POST', `/v1/services/${id}/stop`),
      start: (id) => send<{ ok: boolean; status: string }>('POST', `/v1/services/${id}/start`),
      restart: (id) => send<{ ok: boolean; status: string }>('POST', `/v1/services/${id}/restart`),
      logs: (id) => get<{ lines: string }>(`/v1/services/${id}/logs`),
      exportUrl: (id) => `/v1/services/${id}/export`,
      importBundle: (bundle) => send('POST', '/v1/services/import', bundle),
    },
    deploys: {
      trigger: (serviceId, input) =>
        send<{ deploymentId: number }>('POST', `/v1/services/${serviceId}/deploys`, input ?? {}),
      list: (serviceId) => get<Deployment[]>(`/v1/services/${serviceId}/deploys`),
      rollback: (serviceId, deploymentId) =>
        send<{ deploymentId: number }>('POST', `/v1/services/${serviceId}/deploys/${deploymentId}/rollback`),
      cancel: (serviceId, deploymentId) =>
        send<{ ok: boolean; status: string }>('POST', `/v1/services/${serviceId}/deploys/${deploymentId}/cancel`),
      configDiff: (serviceId, deploymentId) =>
        get<{ deploymentId: number; previousDeploymentId: number | null; changed: boolean; diff: string }>(
          `/v1/services/${serviceId}/deploys/${deploymentId}/diff`,
        ),
    },
    domains: {
      list: (serviceId) => get<Domain[]>(`/v1/services/${serviceId}/domains`),
      create: (serviceId, input) => send<Domain>('POST', `/v1/services/${serviceId}/domains`, input),
      update: (serviceId, domainId, input) =>
        send<Domain>('PATCH', `/v1/services/${serviceId}/domains/${domainId}`, input),
      remove: async (serviceId, domainId) => {
        await request(`/v1/services/${serviceId}/domains/${domainId}`, { method: 'DELETE' });
      },
      all: () => get<DomainEntry[]>('/v1/domains'),
      setSsl: (domainId, ssl) => send<{ id: number; ssl: boolean }>('PATCH', `/v1/domains/${domainId}`, { ssl }),
    },
    volumes: {
      list: () => get<VolumeEntry[]>('/v1/volumes'),
      listFiles: (name, path = '') =>
        get<{ path: string; entries: VolumeFileEntry[] }>(`/v1/volumes/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`),
      readFile: (name, path) =>
        get<{ content: string; encoding: 'utf8' | 'base64' }>(`/v1/volumes/${encodeURIComponent(name)}/files/content?path=${encodeURIComponent(path)}`),
      writeFile: (name, input) => send<{ ok: boolean }>('PUT', `/v1/volumes/${encodeURIComponent(name)}/files`, input),
      mkdir: (name, input) => send<{ ok: boolean }>('POST', `/v1/volumes/${encodeURIComponent(name)}/files/dir`, input),
      deleteFile: async (name, path) => {
        await request(`/v1/volumes/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      },
      remove: async (name) => {
        await request(`/v1/volumes/${encodeURIComponent(name)}`, { method: 'DELETE' });
      },
      prune: () => send<{ ok: boolean; deleted: number; freedBytes: number }>('POST', '/v1/volumes/prune'),
    },
    system: {
      resources: () => get<DockerResources>('/v1/system/resources'),
      pruneImages: () => send<{ ok: boolean }>('POST', '/v1/system/prune-images'),
      updateCheck: (force) => get<UpdateCheckResult>(`/v1/system/update-check${force ? '?force=1' : ''}`),
      exportUrl: () => '/v1/system/export',
      dockerEvents: (minutes) =>
        get<{ events: Array<{ time: string; type: string; action: string; name: string }> }>(
          `/v1/system/docker-events?minutes=${minutes ?? 60}`,
        ),
    },
    networks: {
      list: () => get<{ networks: Array<{ name: string; driver: string; members: string[] }>; remote: number | null }>('/v1/networks'),
      create: (input) => send<{ ok: boolean; name: string }>('POST', '/v1/networks', { driver: 'bridge', ...input }),
      remove: (name, serverId) =>
        send<{ ok: boolean }>('DELETE', `/v1/networks/${encodeURIComponent(name)}${serverId ? `?serverId=${serverId}` : ''}`),
      attach: (input) => send<{ ok: boolean }>('POST', '/v1/networks/attach', input),
      detach: (input) => send<{ ok: boolean }>('POST', '/v1/networks/detach', input),
    },
    tunnels: {
      list: () => get<TunnelEntry[]>('/v1/tunnels'),
      create: (input) => send<TunnelEntry>('POST', '/v1/tunnels', input),
      remove: async (id) => {
        await request(`/v1/tunnels/${id}`, { method: 'DELETE' });
      },
    },
  activity: {
    list: (query) => {
      const parts: string[] = [];
      if (query?.entity) parts.push(`entity=${encodeURIComponent(query.entity)}`);
      if (query?.action) parts.push(`action=${encodeURIComponent(query.action)}`);
      if (query?.userId) parts.push(`userId=${query.userId}`);
      if (query?.before) parts.push(`before=${query.before}`);
      const qs = parts.join('&');
      return get<{ entries: ActivityEntry[]; nextCursor: number | null }>(`/v1/activity${qs ? `?${qs}` : ''}`);
    },
  },
  alerts: {
    list: () => get('/v1/alerts'),
    create: (input) => send('POST', '/v1/alerts', input),
    update: (id, input) => send('PATCH', `/v1/alerts/${id}`, input),
    remove: async (id) => {
      await request(`/v1/alerts/${id}`, { method: 'DELETE' });
    },
  },
    settings: {
      get: () => get<{ allowRegistration: boolean; acmeEmail: string | null; templatesSource: string | null; dnsProvider: string | null; hasDnsToken: boolean; wildcardApex: string | null }>('/v1/settings'),
      setAllowRegistration: (enabled) =>
        send<{ ok: boolean; allowRegistration: boolean }>('PUT', '/v1/settings/allow-registration', { enabled }),
      setAcmeEmail: (email) =>
        send<{ ok: boolean; acmeEmail: string | null; applied: string }>('PUT', '/v1/settings/acme-email', { email }),
      setTemplatesSource: (source) =>
        send<{ ok: boolean; templatesSource: string | null }>('PUT', '/v1/settings/templates-source', { source }),
      setDns: (input) =>
        send<{ ok: boolean; dnsProvider: string | null; wildcardApex: string | null; applied: string }>('PUT', '/v1/settings/dns', input),
      vault: {
        get: () =>
          get<{ provider: string | null; hasToken: boolean; projectId: string | null; environment: string | null }>('/v1/settings/vault'),
        set: (input) => send<{ ok: boolean; provider: string | null }>('PUT', '/v1/settings/vault', input),
        test: () => send<{ ok: boolean; secrets: number }>('POST', '/v1/settings/vault/test'),
      },
      dnsRecords: {
        get: () => get<{ enabled: boolean; hasToken: boolean; content: string | null }>('/v1/settings/dns-records'),
        set: (input) => send<{ ok: boolean; enabled: boolean }>('PUT', '/v1/settings/dns-records', input),
        test: () => send<{ ok: boolean; status?: string; error?: string }>('POST', '/v1/settings/dns-records/test'),
      },
    },
    users: {
      list: () => get<PublicUser[]>('/v1/users'),
      create: (input) => send<PublicUser>('POST', '/v1/users', input),
      setRole: (id, role) => send<PublicUser>('PATCH', `/v1/users/${id}/role`, { role }),
      resetPassword: (id, input) => send<{ ok: boolean }>('PATCH', `/v1/users/${id}/password`, input),
      resetLink: (id) => send<{ url: string; expiresAt: string }>('POST', `/v1/users/${id}/reset-link`),
      remove: async (id) => {
        await request(`/v1/users/${id}`, { method: 'DELETE' });
      },
    },
    projects: {
      list: () => get<ProjectEntry[]>('/v1/projects'),
      create: (input) => send<ProjectEntry>('POST', '/v1/projects', input),
      update: (id, input) => send<ProjectEntry>('PATCH', `/v1/projects/${id}`, input),
      remove: (id) => send<{ ok: boolean }>('DELETE', `/v1/projects/${id}`),
    },
    about: {
      get: () => get('/v1/about'),
    },
    notifications: {
      listChannels: () => get('/v1/notifications/channels'),
      createChannel: (input) => send('POST', '/v1/notifications/channels', input),
      updateChannel: (id, input) => send('PATCH', `/v1/notifications/channels/${id}`, input),
      removeChannel: async (id) => { await request(`/v1/notifications/channels/${id}`, { method: 'DELETE' }); },
      testChannel: (id) => send('POST', `/v1/notifications/channels/${id}/test`),
      log: () => get('/v1/notifications/log'),
    },
    sources: {
      list: () => get<Source[]>('/v1/sources'),
      create: (input) => send<Source>('POST', '/v1/sources', input),
      update: (id, input) => send<Source>('PATCH', `/v1/sources/${id}`, input),
      remove: async (id) => {
        await request(`/v1/sources/${id}`, { method: 'DELETE' });
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
      list: (query) => get<ManagedDatabase[]>(`/v1/databases${query ?? ''}`),
      create: (input) => send<ManagedDatabase>('POST', '/v1/databases', input),
      get: (id) => get<ManagedDatabase>(`/v1/databases/${id}`),
      remove: async (id, opts) => {
        await request(`/v1/databases/${id}${opts?.force ? '?force=true' : ''}`, { method: 'DELETE' });
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
      search: (q) =>
        get<{ results: Array<{ key: string; isSecret: boolean; scope: string; serviceId: number | null; serviceName: string | null }> }>(
          `/v1/env/search?q=${encodeURIComponent(q)}`,
        ),
    },
    projectEnv: {
      list: (projectId) => get<EnvVar[]>(`/v1/projects/${projectId}/env`),
      create: (projectId, input) => send<EnvVar>('POST', `/v1/projects/${projectId}/env`, input),
      update: (projectId, varId, input) => send<EnvVar>('PATCH', `/v1/projects/${projectId}/env/${varId}`, input),
      remove: async (projectId, varId) => {
        await request(`/v1/projects/${projectId}/env/${varId}`, { method: 'DELETE' });
      },
    },
    stats: {
      snapshot: () => get<StatsSnapshot>('/v1/stats'),
      metrics: (serviceId, opts) =>
        get<MetricSeries>(
          `/v1/services/${serviceId}/metrics?kind=${opts?.kind ?? 'cpu'}&minutes=${opts?.minutes ?? 60}`,
        ),
    },
    dashboard: {
      get: () => get('/v1/dashboard'),
    },
    topology: {
      get: () => get<TopologyGraph>('/v1/topology'),
    },
    templates: {
      list: () => get<TemplateSummary[]>('/v1/templates'),
      get: (id) => get<Template>(`/v1/templates/${id}`),
      deploy: (id) => send<{ serviceId: number; deploymentId: number }>('POST', `/v1/templates/${id}/deploy`),
    },
    backups: {
      storage: (databaseId) => get<{ sizeBytes: number }>(`/v1/databases/${databaseId}/storage`),
      backupNow: (databaseId) => send<Backup>('POST', `/v1/databases/${databaseId}/backups`),
      listForDb: (databaseId) => get<Backup[]>(`/v1/databases/${databaseId}/backups`),
      restore: (databaseId, backupId) => send<{ ok: boolean }>('POST', `/v1/databases/${databaseId}/backups/${backupId}/restore`),
      list: () => get<BackupWithDb[]>('/v1/backups'),
      remove: async (backupId) => {
        await request(`/v1/backups/${backupId}`, { method: 'DELETE' });
      },
      downloadUrl: (backupId) => `/v1/backups/${backupId}/download`,
    },
    backupDestinations: {
      list: () => get('/v1/backup-destinations'),
      create: (input) => send<{ id: number }>('POST', '/v1/backup-destinations', input),
      update: (id, input) => send<{ ok: boolean }>('PATCH', `/v1/backup-destinations/${id}`, input),
      remove: (id) => send<{ ok: boolean }>('DELETE', `/v1/backup-destinations/${id}`),
      test: (id) => send<{ ok: boolean }>('POST', `/v1/backup-destinations/${id}/test`),
    },
    jobs: {
      list: (serviceId) => get(`/v1/services/${serviceId}/jobs`),
      create: (serviceId, input) => send<{ id: number }>('POST', `/v1/services/${serviceId}/jobs`, input),
      update: (serviceId, jobId, input) => send<{ ok: boolean }>('PATCH', `/v1/services/${serviceId}/jobs/${jobId}`, input),
      remove: (serviceId, jobId) => send<{ ok: boolean }>('DELETE', `/v1/services/${serviceId}/jobs/${jobId}`),
      run: (serviceId, jobId) => send<{ ok: boolean }>('POST', `/v1/services/${serviceId}/jobs/${jobId}/run`),
      runs: (serviceId, jobId) => get(`/v1/services/${serviceId}/jobs/${jobId}/runs`),
    },
    servers: {
      list: () => get('/v1/servers'),
      create: (input) => send('POST', '/v1/servers', input),
      remove: (id, opts) => send<{ ok: boolean }>('DELETE', `/v1/servers/${id}${opts?.force ? '?force=true' : ''}`),
      test: (id) => send<{ ok: boolean; status: string }>('POST', `/v1/servers/${id}/test`),
      approve: (id) => send<{ ok: boolean; status: string }>('POST', `/v1/servers/${id}/approve`),
      reject: (id) => send<{ ok: boolean }>('POST', `/v1/servers/${id}/reject`),
    },
    limits: {
      setService: (serviceId, input) =>
        send<{ cpuShares: number; memLimitMb: number }>('PATCH', `/v1/services/${serviceId}/limits`, input),
      setDatabase: (databaseId, input) =>
        send<{ cpuShares: number; memLimitMb: number }>('PATCH', `/v1/databases/${databaseId}/limits`, input),
    },
    traefik: {
      get: () => get<TraefikInfo>('/v1/traefik'),
      status: () => get<TraefikStatus>('/v1/traefik/status'),
      certificates: () => get<TraefikCertificate[]>('/v1/traefik/certificates'),
      logs: (lines = 50) => get<{ logs: string[] }>(`/v1/traefik/logs?lines=${lines}`),
      restart: () => send<{ ok: boolean; message: string }>('POST', '/v1/traefik/restart'),
      backupCerts: () => send<{ ok: boolean; message: string; filename?: string }>('POST', '/v1/traefik/backup-certs'),
    },
    health: () => get<HealthStatus>('/health'),
  };
}
