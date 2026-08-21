import { relations, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * NineDeploy — database schema (single source of truth).
 *
 * All tables live in one SQLite file. Timestamps are unix-epoch seconds.
 * Secrets are stored encrypted (AES-256-GCM) in their `*_encrypted` columns.
 */

// ─── helpers ──────────────────────────────────────────────────────────────
const id = () => integer('id').primaryKey({ autoIncrement: true });
const ts = (name: string) =>
  integer(name, { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`);
const tsUpdatable = (name: string) =>
  integer(name, { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date());

// ─── enums (stored as TEXT) ───────────────────────────────────────────────
export const userRole = ['admin', 'member'] as const;
export const workspaceRole = ['owner', 'admin', 'member', 'viewer'] as const;
export const serviceType = ['pm2', 'docker', 'compose'] as const;
export const serviceStatus = [
  'idle',
  'deploying',
  'running',
  'stopped',
  'error',
  'deleting',
] as const;
export const buildPack = ['auto', 'nixpacks', 'dockerfile'] as const;
export const deploymentStatus = [
  'queued',
  'building',
  'deploying',
  'running',
  'failed',
  'cancelled',
] as const;
export const deploymentTrigger = ['user', 'webhook', 'cli', 'schedule'] as const;
export const domainStatus = ['pending', 'active', 'error'] as const;
export const sourceType = ['github', 'gitlab', 'gitea', 'bitbucket', 'custom', 'registry'] as const;
export const backupScope = ['db', 'scheduled', 'volumes', 'full'] as const;
export const backupStatus = ['pending', 'running', 'completed', 'failed'] as const;
export const jobKind = ['deploy', 'exec'] as const;
export const jobRunStatus = ['running', 'completed', 'failed'] as const;
export const serverStatus = ['offline', 'online', 'error', 'pending'] as const;

// ─── users & auth ─────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role', { enum: userRole }).notNull().default('member'),
  // Monotonic counter baked into issued JWTs (`ver` claim). Bumping it
  // (logout / role change / password change) invalidates all outstanding tokens
  // for the user without needing a server-side blocklist.
  tokenVersion: integer('token_version').notNull().default(0),
  // TOTP (2FA): secret encrypted at rest; null = never set up.
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  // Highest TOTP step already accepted for this user. A code is single-use:
  // replaying one inside the +/-1-step (90 s) drift window is refused because
  // its step is no longer strictly greater than this. Null = none used yet.
  totpLastStep: integer('totp_last_step'),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // The token presented by clients is hashed (sha256) before comparison.
    hash: text('hash').notNull().unique(),
    scopes: text('scopes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdAt: ts('created_at'),
  },
  // Plain index (NOT unique): a user may hold many API tokens. The previous
  // uniqueIndex here silently capped every user to a single token.
  (t) => ({ userIdx: index('api_tokens_user_idx').on(t.userId) }),
);

// WebAuthn (passkey) credentials: one row per registered authenticator.
// publicKey is the COSE public key bytes (base64url); counter tracks the
// signature counter for clone detection.
export const webauthnCredentials = sqliteTable(
  'webauthn_credentials',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    name: text('name').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => ({ userIdx: index('webauthn_credentials_user_idx').on(t.userId) }),
);

// Per-session rows backing refresh tokens. `jti` matches the JWT claim; a
// revoked/expired row makes the corresponding refresh token unusable even
// before password/tokenVersion changes.
export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jti: text('jti').notNull().unique(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at'),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }),
);

// ─── workspaces & teams ───────────────────────────────────────────────────
export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: workspaceRole }).notNull().default('member'),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({
    workspaceUserIdx: uniqueIndex('workspace_members_workspace_user_idx').on(t.workspaceId, t.userId),
    userIdx: index('workspace_members_user_idx').on(t.userId),
  }),
);

export const oidcProviders = sqliteTable('oidc_providers', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  issuerUrl: text('issuer_url'),
  clientId: text('client_id').notNull(),
  clientSecretEncrypted: text('client_secret_encrypted').notNull(),
  scopes: text('scopes').notNull().default('openid profile email'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  autoEnroll: integer('auto_enroll', { mode: 'boolean' }).notNull().default(true),
  defaultRole: text('default_role', { enum: userRole }).notNull().default('member'),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

// ─── projects & services ──────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: id(),
  workspaceId: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

export const services = sqliteTable(
  'services',
  {
    id: id(),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    type: text('type', { enum: serviceType }).notNull().default('docker'),
    status: text('status', { enum: serviceStatus }).notNull().default('idle'),
    repoUrl: text('repo_url'),
    branch: text('branch').notNull().default('main'),
    commitSha: text('commit_sha'),
    sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
    // Image-based deploy (no repo): skip git+build and run this image directly.
    image: text('image'),
    // Optional container path to mount a persistent named volume (nd-svc-<slug>-data).
    volumeMount: text('volume_mount'),
    port: integer('port'),
    // Direct host port mapping (e.g. 8080) for domain-less external access.
    publishedPort: integer('published_port'),
    healthPath: text('health_path').notNull().default('/'),
    // Runtime identifier: pm2 process name or docker container name.
    runtimeId: text('runtime_id'),
    // Resource limits (0 = unlimited). cpuShares maps to docker --cpu-shares,
    // memLimitMb maps to docker --memory (MiB).
    cpuShares: integer('cpu_shares').notNull().default(0),
    memLimitMb: integer('mem_limit_mb').notNull().default(0),
    // Template-defined container command (argv after the image). Only the
    // admin-controlled template registry sets it — not the create-service API.
    cmd: text('cmd', { mode: 'json' }).$type<string[]>(),
    // Bind-mount the host Docker socket (template flag only — docker control).
    dockerSocket: integer('docker_socket', { mode: 'boolean' }).notNull().default(false),
    // Durable Hub identity. The worker uses this to resume idempotent template
    // dependency provisioning after a process/host restart.
    templateId: text('template_id'),
    // Trusted Hub template mapping from application env names to managed DB
    // connection fields. Generic service requests cannot set this directly.
    templateDatabaseEnv: text('template_database_env', { mode: 'json' }).$type<Record<string, 'url' | 'host' | 'hostPort' | 'port' | 'username' | 'password' | 'database'>>(),
    // Remote server this service deploys to (null = this host). Agent-based.
    serverId: integer('server_id').references(() => servers.id, { onDelete: 'set null' }),
    // Compose deploys: the "main" service in the compose file (routing target).
    composeService: text('compose_service'),
    // Ephemeral PR / MR Preview Deployments settings
    previewDeploymentsEnabled: integer('preview_deployments_enabled', { mode: 'boolean' }).notNull().default(false),
    previewAutoDestroyOnClose: integer('preview_auto_destroy_on_close', { mode: 'boolean' }).notNull().default(true),
    previewDomainPattern: text('preview_domain_pattern'),
    previewMaxActive: integer('preview_max_active').notNull().default(5),
    isEphemeralPreview: integer('is_ephemeral_preview', { mode: 'boolean' }).notNull().default(false),
    previewParentServiceId: integer('preview_parent_service_id').references((): AnySQLiteColumn => services.id, { onDelete: 'cascade' }),
    prNumber: integer('pr_number'),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ projectSlugIdx: uniqueIndex('services_project_slug_idx').on(t.projectId, t.slug) }),
);

export const buildConfigs = sqliteTable('build_configs', {
  id: id(),
  serviceId: integer('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  buildPack: text('build_pack', { enum: buildPack }).notNull().default('auto'),
  baseDir: text('base_dir').notNull().default('/'),
  installCmd: text('install_cmd'),
  buildCmd: text('build_cmd'),
  startCmd: text('start_cmd'),
  dockerfilePath: text('dockerfile_path'),
  // CI/CD Lifecycle Hooks
  preDeployCmd: text('pre_deploy_cmd'),
  postDeployCmd: text('post_deploy_cmd'),
  preStopCmd: text('pre_stop_cmd'),
  // Container restart policy (docker --restart). 'on-failure:N' caps the
  // restart loop; 'always'/'unless-stopped'/'no' pass through verbatim.
  restartPolicy: text('restart_policy').notNull().default('unless-stopped'),
  // Seconds to wait for graceful stop before SIGKILL (docker stop -t).
  stopGraceSeconds: integer('stop_grace_seconds').notNull().default(5),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

// ─── repository insights ───────────────────────────────────────────────────
// One row per repo-backed service: the latest framework analysis produced at
// deploy time (pipeline PREPARE) or by an on-demand refresh. Powers the
// "what's in this repo" card and the Framework tab. `data` stores the full
// RepoInsights JSON (packages/schemas/src/insights.ts); `frameworkId` is
// denormalized for cheap filtering.
export const repoInsights = sqliteTable(
  'repo_insights',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    frameworkId: text('framework_id').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    commitSha: text('commit_sha'),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ serviceIdIdx: uniqueIndex('repo_insights_service_idx').on(t.serviceId) }),
);

// ─── deployments ──────────────────────────────────────────────────────────
export const deployments = sqliteTable(
  'deployments',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    status: text('status', { enum: deploymentStatus }).notNull().default('queued'),
    commitSha: text('commit_sha'),
    // Resolved image digest (sha256:...) the runtime actually ran. Lets rollback
    // pin the exact image instead of re-pulling a mutable tag like `:latest`.
    imageDigest: text('image_digest'),
    message: text('message'),
    author: text('author'),
    trigger: text('trigger', { enum: deploymentTrigger }).notNull().default('user'),
    logPath: text('log_path'),
    // JSON snapshot of the effective build config + env key fingerprint at
    // deploy start — powers the config diff against the previous deployment.
    configSnapshot: text('config_snapshot'),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    // Non-unique on purpose: `created_at` is second-precision (unixepoch), so a
    // second deploy of the same service within the same second would collide
    // with a UNIQUE constraint and 500 on trigger. History lists order by id
    // (monotonic) instead, so the index only needs to accelerate the filter.
    serviceCreatedIdx: index('deployments_service_created_idx').on(t.serviceId, t.createdAt),
    // The deploy worker polls WHERE status='queued' every 2s — index status.
    statusIdx: index('deployments_status_idx').on(t.status),
  }),
);

// ─── env vars & secrets ───────────────────────────────────────────────────
// scope='service' (default): per-service, serviceId set.
// scope='project': shared across every service in a project, serviceId null,
// scopeKey = projectId. Service-scope values win over project-scope at merge.
export const envScope = ['service', 'project'] as const;

export const envVars = sqliteTable(
  'env_vars',
  {
    id: id(),
    serviceId: integer('service_id').references(() => services.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: envScope }).notNull().default('service'),
    // Disambiguator for the unique index: serviceId for scope='service',
    // projectId for scope='project'. Both notNull so (scope, scopeKey, key)
    // stays truly unique across rows.
    scopeKey: integer('scope_key').notNull().default(0),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({
    serviceKeyIdx: uniqueIndex('env_vars_service_key_idx').on(t.serviceId, t.key),
    scopeKeyIdx: uniqueIndex('env_vars_scope_key_idx').on(t.scope, t.scopeKey, t.key),
  }),
);

// ─── git sources ──────────────────────────────────────────────────────────
export const sources = sqliteTable('sources', {
  id: id(),
  type: text('type', { enum: sourceType }).notNull(),
  name: text('name').notNull(),
  // OAuth/token or deploy key material — always encrypted at rest.
  tokenEncrypted: text('token_encrypted'),
  deployKeyEncrypted: text('deploy_key_encrypted'),
  // Registry-type sources: username for `docker login` (token = password).
  registryUsername: text('registry_username'),
  defaultBranch: text('default_branch').default('main'),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

export const domains = sqliteTable(
  'domains',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    path: text('path').notNull().default('/'),
    ssl: integer('ssl', { mode: 'boolean' }).notNull().default(true),
    redirectWww: integer('redirect_www', { mode: 'boolean' }).notNull().default(false),
    // Custom response headers as a JSON array [{name, value}] → Traefik headers middleware.
    headers: text('headers'),
    // Basic Auth credentials (JSON array of "user:htpasswd_hash" or "user:pass")
    basicAuth: text('basic_auth'),
    // IP Allowlist (comma-separated CIDRs e.g. "1.2.3.4/32, 10.0.0.0/8")
    ipAllowlist: text('ip_allowlist'),
    // Rate limit: average requests/second (0 or null = disabled)
    rateLimitAverage: integer('rate_limit_average'),
    // Rate limit: burst peak requests allowed (0 or null = disabled)
    rateLimitBurst: integer('rate_limit_burst'),
    status: text('status', { enum: domainStatus }).notNull().default('pending'),
    // H-2 layer 2: proof that the claimant controls the DNS zone. A hostname
    // outside this instance's own zone stays `pending` — and unrouted — until
    // a TXT record at _ninedeploy-challenge.<hostname> matches this token.
    verificationToken: text('verification_token'),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    // External DNS record id (e.g. Cloudflare) when the provider integration
    // created the record — null for provider-less/manual DNS.
    dnsRecordId: text('dns_record_id'),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({
    hostPathIdx: uniqueIndex('domains_host_path_idx').on(t.hostname, t.path),
    serviceIdx: index('domains_service_idx').on(t.serviceId),
  }),
);

export const webhooks = sqliteTable('webhooks', {
  id: id(),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
  serviceId: integer('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  branch: text('branch').notNull(),
  events: text('events', { mode: 'json' }).$type<string[]>().notNull().default(sql`'["push"]'`),
  // Optional newline/comma-separated globs — deploy only when a changed file matches (monorepos).
  watchPaths: text('watch_paths'),
  secretEncrypted: text('secret_encrypted').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at'),
});

// ─── backups & monitoring ─────────────────────────────────────────────────
export const backups = sqliteTable(
  'backups',
  {
    id: id(),
    databaseId: integer('database_id').references(() => databases.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: backupScope }).notNull(),
    status: text('status', { enum: backupStatus }).notNull().default('pending'),
    path: text('path').notNull(),
    // S3 object key when the encrypted envelope was uploaded to a destination.
    remoteKey: text('remote_key'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: ts('created_at'),
  },
  (t) => ({ dbStatusIdx: index('backups_db_status_idx').on(t.databaseId, t.status) }),
);

// ─── S3-compatible backup destinations ────────────────────────────────────
export const backupDestinations = sqliteTable('backup_destinations', {
  id: id(),
  name: text('name').notNull(),
  // S3-compatible endpoint, e.g. https://s3.eu-central-1.amazonaws.com or a MinIO URL.
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull().default('us-east-1'),
  bucket: text('bucket').notNull(),
  prefix: text('prefix').notNull().default('ninedeploy'),
  accessKeyId: text('access_key_id').notNull(),
  secretKeyEncrypted: text('secret_key_encrypted').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

export const metrics = sqliteTable(
  'metrics',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // cpu | memory | status | response_ms
    value: integer('value').notNull(),
    ts: ts('ts'),
  },
  // High-volume time-series table: every read filters serviceId + kind + ts>=,
  // and retention deletes by ts. A composite index makes both fast.
  (t) => ({ serviceKindTsIdx: index('metrics_service_kind_ts_idx').on(t.serviceId, t.kind, t.ts) }),
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity'),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    ts: ts('ts'),
  },
  (t) => ({ entityTsIdx: index('audit_log_entity_ts_idx').on(t.entity, t.ts) }),
);

export const settings = sqliteTable(
  'settings',
  {
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).notNull(),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.key] }) }),
);

// ─── managed databases ────────────────────────────────────────────────────
export const dbEngine = ['postgres', 'mysql', 'mariadb', 'redis', 'mongo', 'valkey', 'clickhouse', 'meilisearch', 'rabbitmq'] as const;
export const dbStatus = ['creating', 'running', 'stopped', 'error', 'deleting'] as const;

export const databases = sqliteTable(
  'databases',
  {
    id: id(),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    // Stamped at creation so a member keeps access to a database they made even
    // when it belongs to no project. NULL on rows predating this column: those
    // fall back to the owning project's workspace, or admin-only.
    ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    engine: text('engine', { enum: dbEngine }).notNull(),
    version: text('version'),
    status: text('status', { enum: dbStatus }).notNull().default('creating'),
    containerName: text('container_name'),
    internalHost: text('internal_host'),
    internalPort: integer('internal_port'),
    username: text('username'),
    passwordEncrypted: text('password_encrypted').notNull(),
    dbName: text('db_name'),
    volumeName: text('volume_name'),
    // Resource limits (0 = unlimited).
    cpuShares: integer('cpu_shares').notNull().default(0),
    memLimitMb: integer('mem_limit_mb').notNull().default(0),
    // Web Studio (GUI): Adminer / Redis Commander / pgweb container port & status
    webGuiEnabled: integer('web_gui_enabled', { mode: 'boolean' }).notNull().default(false),
    webGuiPort: integer('web_gui_port'),
    // Installed extensions (e.g. ['pgvector', 'postgis'] for PostgreSQL)
    extensions: text('extensions', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ slugIdx: uniqueIndex('databases_slug_idx').on(t.slug) }),
);

export const databaseAttachments = sqliteTable(
  'database_attachments',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    databaseId: integer('database_id')
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    envAlias: text('env_alias').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => ({ uniq: uniqueIndex('db_attach_svc_db_idx').on(t.serviceId, t.databaseId) }),
);

// ─── cloudflare tunnels ───────────────────────────────────────────────────
export const tunnelStatus = ['running', 'stopped', 'error'] as const;

export const tunnels = sqliteTable(
  'tunnels',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    tokenEncrypted: text('token_encrypted').notNull(),
    status: text('status', { enum: tunnelStatus }).notNull().default('running'),
    containerName: text('container_name').notNull(),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ slugIdx: uniqueIndex('tunnels_slug_idx').on(t.slug) }),
);

// ─── notification channels ────────────────────────────────────────────────
export const channelType = ['telegram', 'webhook', 'discord', 'slack', 'ntfy', 'email'] as const;
export const notificationChannels = sqliteTable(
  'notification_channels',
  {
    id: id(),
    name: text('name').notNull(),
    type: text('type', { enum: channelType }).notNull(),
    targetEncrypted: text('target_encrypted').notNull(),
    eventFilter: text('event_filter').notNull().default(''),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ nameIdx: uniqueIndex('notification_channels_name_idx').on(t.name) }),
);

export const notificationLog = sqliteTable(
  'notification_log',
  {
    id: id(),
    channelId: integer('channel_id').references(() => notificationChannels.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    entity: text('entity'),
    status: text('status', { enum: ['sent', 'failed'] as const }).notNull().default('sent'),
    // Delivery attempts (retry with exponential backoff) for this notification.
    attempts: integer('attempts').notNull().default(1),
    error: text('error'),
    ts: ts('ts'),
  },
  (t) => ({ channelTsIdx: index('notification_log_channel_ts_idx').on(t.channelId, t.ts) }),
);

// ─── alerting ──────────────────────────────────────────────────────────────
export const alertMetric = ['cpu', 'memory', 'cert-expiry'] as const;
export const alertOperator = ['>', '<'] as const;
export const alertStateStatus = ['ok', 'breaching', 'firing'] as const;

export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: id(),
    // Null = host-wide rule (evaluated against host metrics).
    serviceId: integer('service_id').references(() => services.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // cpu: percent (0-100); memory: MiB; cert-expiry: days remaining.
    metric: text('metric', { enum: alertMetric }).notNull(),
    operator: text('operator', { enum: alertOperator }).notNull().default('>'),
    threshold: integer('threshold').notNull(),
    // Number of consecutive 30s samples that must breach before firing.
    durationWindows: integer('duration_windows').notNull().default(1),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ nameIdx: uniqueIndex('alert_rules_name_idx').on(t.name) }),
);

// One row per rule tracking the breach lifecycle (detection → firing → recovery).
export const alertState = sqliteTable('alert_state', {
  ruleId: integer('rule_id')
    .notNull()
    .references(() => alertRules.id, { onDelete: 'cascade' })
    .unique(),
  status: text('status', { enum: alertStateStatus }).notNull().default('ok'),
  breachSince: integer('breach_since', { mode: 'timestamp' }),
  firedAt: integer('fired_at', { mode: 'timestamp' }),
  lastNotifiedAt: integer('last_notified_at', { mode: 'timestamp' }),
  lastValue: integer('last_value'),
  updatedAt: tsUpdatable('updated_at'),
});

// ─── relations ────────────────────────────────────────────────────────────
// ─── scheduled jobs (cron) ────────────────────────────────────────────────
export const scheduledJobs = sqliteTable(
  'scheduled_jobs',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // 5-field cron expression (minute hour dom month dow), user-local timezone.
    cron: text('cron').notNull(),
    // deploy → re-deploy the service; exec → run `command` inside the runtime container.
    kind: text('kind', { enum: jobKind }).notNull().default('deploy'),
    command: text('command'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ serviceIdx: index('scheduled_jobs_service_idx').on(t.serviceId) }),
);

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: id(),
    jobId: integer('job_id')
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: 'cascade' }),
    status: text('status', { enum: jobRunStatus }).notNull().default('running'),
    output: text('output').notNull().default(''),
    exitCode: integer('exit_code'),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    createdAt: ts('created_at'),
  },
  (t) => ({ jobIdx: index('job_runs_job_idx').on(t.jobId) }),
);

// ─── remote servers (agent-based multi-server) ────────────────────────────
export const servers = sqliteTable('servers', {
  id: id(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(4600),
  status: text('status', { enum: serverStatus }).notNull().default('offline'),
  // Shared secret the agent presents. The raw token is encrypted at rest so
  // the core can use it for exec calls; sha256 hash would be one-way.
  tokenEncrypted: text('token_encrypted').notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // sha256 of the raw token — the raw value exists only in the delivery message.
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  requestedFrom: text('requested_from'),
  createdAt: tsUpdatable('created_at'),
}, (t) => [index('password_reset_tokens_user_idx').on(t.userId)]);

// ─── configuration center & plugins ──────────────────────────────────────────
export const configEntries = sqliteTable(
  'config_entries',
  {
    key: text('key').primaryKey(),
    pluginId: text('plugin_id'),
    value: text('value').notNull(),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
    category: text('category').notNull().default('general'),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    description: text('description'),
    updatedAt: tsUpdatable('updated_at'),
    updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    pluginIdx: index('config_entries_plugin_idx').on(t.pluginId),
    categoryIdx: index('config_entries_category_idx').on(t.category),
  }),
);

export const installedPlugins = sqliteTable(
  'installed_plugins',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    description: text('description'),
    author: text('author'),
    icon: text('icon'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    isOfficial: integer('is_official', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['active', 'disabled', 'errored', 'installing'] })
      .notNull()
      .default('active'),
    error: text('error'),
    manifest: text('manifest', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({
    statusIdx: index('installed_plugins_status_idx').on(t.status),
  }),
);

// ─── log drains ───────────────────────────────────────────────────────────
export const logDrainType = ['syslog', 'loki', 'vector', 'datadog', 'http'] as const;
export const logDrainFormat = ['json', 'raw', 'rfc5424'] as const;

export const logDrains = sqliteTable(
  'log_drains',
  {
    id: id(),
    name: text('name').notNull(),
    type: text('type', { enum: logDrainType }).notNull().default('http'),
    url: text('url').notNull(),
    apiKeyEncrypted: text('api_key_encrypted'),
    serviceId: integer('service_id').references(() => services.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    format: text('format', { enum: logDrainFormat }).notNull().default('json'),
    headersJson: text('headers_json'),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({
    serviceIdx: index('log_drains_service_idx').on(t.serviceId),
  }),
);

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const configEntriesRelations = relations(configEntries, ({ one }) => ({
  updatedByUser: one(users, { fields: [configEntries.updatedBy], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  apiTokens: many(apiTokens),
  webauthnCredentials: many(webauthnCredentials),
  sessions: many(sessions),
  ownedWorkspaces: many(workspaces),
  workspaceMemberships: many(workspaceMembers),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  members: many(workspaceMembers),
  projects: many(projects),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const webauthnCredentialsRelations = relations(webauthnCredentials, ({ one }) => ({
  user: one(users, { fields: [webauthnCredentials.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  project: one(projects, { fields: [services.projectId], references: [projects.id] }),
  buildConfig: one(buildConfigs),
  deployments: many(deployments),
  envVars: many(envVars),
  domains: many(domains),
}));

export const buildConfigsRelations = relations(buildConfigs, ({ one }) => ({
  service: one(services, { fields: [buildConfigs.serviceId], references: [services.id] }),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  service: one(services, { fields: [deployments.serviceId], references: [services.id] }),
}));

export const envVarsRelations = relations(envVars, ({ one }) => ({
  service: one(services, { fields: [envVars.serviceId], references: [services.id] }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  service: one(services, { fields: [domains.serviceId], references: [services.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  service: one(services, { fields: [webhooks.serviceId], references: [services.id] }),
  source: one(sources, { fields: [webhooks.sourceId], references: [sources.id] }),
}));

export const metricsRelations = relations(metrics, ({ one }) => ({
  service: one(services, { fields: [metrics.serviceId], references: [services.id] }),
}));

export const databasesRelations = relations(databases, ({ one, many }) => ({
  project: one(projects, { fields: [databases.projectId], references: [projects.id] }),
  attachments: many(databaseAttachments),
}));

export const databaseAttachmentsRelations = relations(databaseAttachments, ({ one }) => ({
  service: one(services, { fields: [databaseAttachments.serviceId], references: [services.id] }),
  database: one(databases, { fields: [databaseAttachments.databaseId], references: [databases.id] }),
}));

export const notificationLogRelations = relations(notificationLog, ({ one }) => ({
  channel: one(notificationChannels, { fields: [notificationLog.channelId], references: [notificationChannels.id] }),
}));

export const alertRulesRelations = relations(alertRules, ({ one }) => ({
  service: one(services, { fields: [alertRules.serviceId], references: [services.id] }),
  state: one(alertState, { fields: [alertRules.id], references: [alertState.ruleId] }),
}));

export const alertStateRelations = relations(alertState, ({ one }) => ({
  rule: one(alertRules, { fields: [alertState.ruleId], references: [alertRules.id] }),
}));

export const logDrainsRelations = relations(logDrains, ({ one }) => ({
  service: one(services, { fields: [logDrains.serviceId], references: [services.id] }),
}));

// ─── type exports ─────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
export type OidcProvider = typeof oidcProviders.$inferSelect;
export type NewOidcProvider = typeof oidcProviders.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type Service = typeof services.$inferSelect;
export type BuildConfig = typeof buildConfigs.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type EnvVar = typeof envVars.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type Backup = typeof backups.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Database = typeof databases.$inferSelect;
export type NewDatabase = typeof databases.$inferInsert;
export type DatabaseAttachment = typeof databaseAttachments.$inferSelect;
export type Tunnel = typeof tunnels.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NotificationLog = typeof notificationLog.$inferSelect;
export type AlertRule = typeof alertRules.$inferSelect;
export type AlertState = typeof alertState.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type BackupDestination = typeof backupDestinations.$inferSelect;
export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type ServerRow = typeof servers.$inferSelect;
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ConfigEntry = typeof configEntries.$inferSelect;
export type NewConfigEntry = typeof configEntries.$inferInsert;
export type InstalledPlugin = typeof installedPlugins.$inferSelect;
export type NewInstalledPlugin = typeof installedPlugins.$inferInsert;
export type LogDrain = typeof logDrains.$inferSelect;
export type NewLogDrain = typeof logDrains.$inferInsert;

