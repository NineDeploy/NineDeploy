import { relations, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
export const serviceType = ['pm2', 'docker'] as const;
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
export const sourceType = ['github', 'gitlab', 'gitea', 'bitbucket', 'custom'] as const;
export const backupScope = ['db', 'scheduled', 'volumes', 'full'] as const;
export const backupStatus = ['pending', 'running', 'completed', 'failed'] as const;

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

// ─── projects & services ──────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: id(),
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
    healthPath: text('health_path').notNull().default('/'),
    // Runtime identifier: pm2 process name or docker container name.
    runtimeId: text('runtime_id'),
    // Resource limits (0 = unlimited). cpuShares maps to docker --cpu-shares,
    // memLimitMb maps to docker --memory (MiB).
    cpuShares: integer('cpu_shares').notNull().default(0),
    memLimitMb: integer('mem_limit_mb').notNull().default(0),
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
  createdAt: ts('created_at'),
  updatedAt: tsUpdatable('updated_at'),
});

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
    startedAt: integer('started_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    createdAt: ts('created_at'),
  },
  (t) => ({
    serviceCreatedIdx: uniqueIndex('deployments_service_created_idx').on(t.serviceId, t.createdAt),
    // The deploy worker polls WHERE status='queued' every 2s — index status.
    statusIdx: index('deployments_status_idx').on(t.status),
  }),
);

// ─── env vars & secrets ───────────────────────────────────────────────────
export const envVars = sqliteTable(
  'env_vars',
  {
    id: id(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(true),
    createdAt: ts('created_at'),
    updatedAt: tsUpdatable('updated_at'),
  },
  (t) => ({ serviceKeyIdx: uniqueIndex('env_vars_service_key_idx').on(t.serviceId, t.key) }),
);

// ─── git sources ──────────────────────────────────────────────────────────
export const sources = sqliteTable('sources', {
  id: id(),
  type: text('type', { enum: sourceType }).notNull(),
  name: text('name').notNull(),
  // OAuth/token or deploy key material — always encrypted at rest.
  tokenEncrypted: text('token_encrypted'),
  deployKeyEncrypted: text('deploy_key_encrypted'),
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
    status: text('status', { enum: domainStatus }).notNull().default('pending'),
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
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: ts('created_at'),
  },
  (t) => ({ dbStatusIdx: index('backups_db_status_idx').on(t.databaseId, t.status) }),
);

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
export const dbEngine = ['postgres', 'mysql', 'redis', 'mongo'] as const;
export const dbStatus = ['creating', 'running', 'stopped', 'error', 'deleting'] as const;

export const databases = sqliteTable(
  'databases',
  {
    id: id(),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
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
export const channelType = ['telegram', 'webhook', 'discord'] as const;

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
    error: text('error'),
    ts: ts('ts'),
  },
  (t) => ({ channelTsIdx: index('notification_log_channel_ts_idx').on(t.channelId, t.ts) }),
);

// ─── relations ────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  apiTokens: many(apiTokens),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
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

// ─── type exports ─────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
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
