import { z } from 'zod';
import { envVarName, gitBranch, gitRepoUrl, httpPath, slug } from './common.js';

export const serviceType = z.enum(['pm2', 'docker', 'compose']);
export const buildPack = z.enum(['auto', 'nixpacks', 'dockerfile']);

export const createService = z.object({
  projectId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100),
  slug: slug.optional(), // derived from name if omitted
  type: serviceType.default('docker'),
  repoUrl: gitRepoUrl.optional(),
  branch: gitBranch.default('main'),
  sourceId: z.number().int().positive().optional(),
  serverId: z.number().int().positive().nullable().optional(),
  image: z.string().optional(),
  volumeMount: z.string().optional(),
  /** Compose deploys: the main service in the compose file (health/routing
   * target). Defaults to the service slug when omitted. */
  composeService: z.string().min(1).max(200).optional(),
  cpuShares: z.number().int().min(0).max(262144).optional(),
  memLimitMb: z.number().int().min(0).optional(),
  healthPath: httpPath.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  publishedPort: z.number().int().min(1).max(65535).nullable().optional(),
  previewDeploymentsEnabled: z.boolean().optional(),
  previewAutoDestroyOnClose: z.boolean().optional(),
  previewDomainPattern: z.string().nullable().optional(),
  previewMaxActive: z.number().int().min(1).max(50).optional(),
  build: z
    .object({
      buildPack: buildPack.default('auto'),
      baseDir: z.string().default('/'),
      installCmd: z.string().optional(),
      buildCmd: z.string().optional(),
      startCmd: z.string().optional(),
      dockerfilePath: z.string().optional(),
      preDeployCmd: z.string().nullable().optional(),
      postDeployCmd: z.string().nullable().optional(),
      preStopCmd: z.string().nullable().optional(),
      // docker --restart policy: fixed values plus on-failure:N (restart-loop cap).
      restartPolicy: z.string().regex(/^(no|always|unless-stopped|on-failure(?::\d{1,3})?)$/).optional(),
      // Seconds between SIGTERM and SIGKILL on stop (docker stop -t).
      stopGraceSeconds: z.number().int().min(0).max(300).optional(),
    })
    .default({ buildPack: 'auto', baseDir: '/' }),
});
export type CreateService = z.infer<typeof createService>;

/** PATCH shape — every field optional, including individual build-config keys.
 * Built explicitly (NOT via createService.partial()): in Zod v4 `partial()`
 * still applies `.default()` values for absent keys, which would silently
 * rewrite `type` back to 'docker' and `branch` to 'main' on every PATCH. */
export const updateService = z.object({
  projectId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100).optional(),
  slug: slug.optional(),
  type: serviceType.optional(),
  repoUrl: gitRepoUrl.optional(),
  branch: gitBranch.optional(),
  sourceId: z.number().int().positive().optional(),
  serverId: z.number().int().positive().nullable().optional(),
  image: z.string().optional(),
  volumeMount: z.string().optional(),
  composeService: z.string().min(1).max(200).optional(),
  cpuShares: z.number().int().min(0).max(262144).optional(),
  memLimitMb: z.number().int().min(0).optional(),
  healthPath: httpPath.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  publishedPort: z.number().int().min(1).max(65535).nullable().optional(),
  previewDeploymentsEnabled: z.boolean().optional(),
  previewAutoDestroyOnClose: z.boolean().optional(),
  previewDomainPattern: z.string().nullable().optional(),
  previewMaxActive: z.number().int().min(1).max(50).optional(),
  build: z
    .object({
      buildPack: buildPack.optional(),
      baseDir: z.string().optional(),
      installCmd: z.string().optional(),
      buildCmd: z.string().optional(),
      startCmd: z.string().optional(),
      dockerfilePath: z.string().optional(),
      preDeployCmd: z.string().nullable().optional(),
      postDeployCmd: z.string().nullable().optional(),
      preStopCmd: z.string().nullable().optional(),
      restartPolicy: z.string().regex(/^(no|always|unless-stopped|on-failure(?::\d{1,3})?)$/).optional(),
      stopGraceSeconds: z.number().int().min(0).max(300).optional(),
    })
    .optional(),
});
export type UpdateService = z.infer<typeof updateService>;

/** Input shapes (what a client sends) — defaults make `build` optional. */
export type CreateServiceInput = z.input<typeof createService>;
export type UpdateServiceInput = z.input<typeof updateService>;

export const service = z.object({
  id: z.number().int(),
  projectId: z.number().int().nullable(),
  serverId: z.number().int().nullable().optional(),
  name: z.string(),
  slug: z.string(),
  type: serviceType,
  status: z.enum(['idle', 'deploying', 'running', 'stopped', 'error', 'deleting']),
  repoUrl: z.string().nullable(),
  branch: z.string(),
  sourceId: z.number().int().nullable(),
  image: z.string().nullable(),
  volumeMount: z.string().nullable(),
  composeService: z.string().nullable(),
  commitSha: z.string().nullable(),
  runtimeId: z.string().nullable(),
  healthPath: z.string(),
  autoUrl: z.string().nullable(),
  port: z.number().int().nullable(),
  publishedPort: z.number().int().nullable().optional(),
  cpuShares: z.number().int(),
  memLimitMb: z.number().int(),
  previewDeploymentsEnabled: z.boolean().optional(),
  previewAutoDestroyOnClose: z.boolean().optional(),
  previewDomainPattern: z.string().nullable().optional(),
  previewMaxActive: z.number().int().optional(),
  isEphemeralPreview: z.boolean().optional(),
  previewParentServiceId: z.number().int().nullable().optional(),
  prNumber: z.number().int().nullable().optional(),
  build: z
    .object({
      buildPack: buildPack,
      baseDir: z.string(),
      installCmd: z.string().nullable(),
      buildCmd: z.string().nullable(),
      startCmd: z.string().nullable(),
      dockerfilePath: z.string().nullable(),
      preDeployCmd: z.string().nullable().optional(),
      postDeployCmd: z.string().nullable().optional(),
      preStopCmd: z.string().nullable().optional(),
      restartPolicy: z.string(),
      stopGraceSeconds: z.number().int(),
    })
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Service = z.infer<typeof service>;

// ── Sources (private repo credentials) ─────────────────────────────────────
export const createSource = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['github', 'gitlab', 'gitea', 'custom', 'registry']),
  token: z.string().optional(),
  deployKey: z.string().optional(),
  // Registry-type sources: username for `docker login` (token = password).
  registryUsername: z.string().max(255).optional(),
  defaultBranch: z.string().optional(),
});
export type CreateSourceInput = z.input<typeof createSource>;

export const source = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  hasToken: z.boolean(),
  hasDeployKey: z.boolean(),
  defaultBranch: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Source = z.infer<typeof source>;

export const triggerDeploy = z.object({
  commitSha: z.string().optional(),
});
export type TriggerDeploy = z.infer<typeof triggerDeploy>;

export const deployment = z.object({
  id: z.number().int(),
  status: z.enum(['queued', 'building', 'deploying', 'running', 'failed', 'cancelled']),
  commitSha: z.string().nullable(),
  message: z.string().nullable(),
  author: z.string().nullable(),
  trigger: z.string(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Deployment = z.infer<typeof deployment>;

// ── Domains (Traefik routing) ─────────────────────────────────────────────
export const createDomain = z.object({
  hostname: z.string().min(3).max(253),
  path: z.string().default('/'),
  // Default matches the DB column default and the CLI (`ssl !== false`):
  // HTTPS everywhere unless explicitly disabled.
  ssl: z.boolean().default(true),
  redirectWww: z.boolean().optional(),
  /** JSON array [{name, value}] of custom response headers. */
  headers: z.string().max(8000).optional(),
  /** Basic Auth credentials (JSON array of "user:htpasswd_hash" or "user:pass"). */
  basicAuth: z.string().max(8000).optional().nullable(),
  /** IP Allowlist (comma-separated CIDRs e.g. "1.2.3.4/32, 10.0.0.0/8"). */
  ipAllowlist: z.string().max(4000).optional().nullable(),
  /** Rate limit: average requests/second. */
  rateLimitAverage: z.number().int().min(0).max(100000).optional().nullable(),
  /** Rate limit: burst peak requests allowed. */
  rateLimitBurst: z.number().int().min(0).max(100000).optional().nullable(),
});
export type CreateDomainInput = z.input<typeof createDomain>;

/** PATCHable routing extras for an existing domain. */
export const domainPatch = z.object({
  ssl: z.boolean().optional(),
  redirectWww: z.boolean().optional(),
  headers: z.string().max(8000).optional().nullable(),
  basicAuth: z.string().max(8000).optional().nullable(),
  ipAllowlist: z.string().max(4000).optional().nullable(),
  rateLimitAverage: z.number().int().min(0).max(100000).optional().nullable(),
  rateLimitBurst: z.number().int().min(0).max(100000).optional().nullable(),
});
export type DomainPatch = z.input<typeof domainPatch>;

export const domain = z.object({
  id: z.number().int(),
  serviceId: z.number().int(),
  hostname: z.string(),
  path: z.string(),
  ssl: z.boolean(),
  redirectWww: z.boolean(),
  headers: z.string(),
  basicAuth: z.string().nullable().optional(),
  ipAllowlist: z.string().nullable().optional(),
  rateLimitAverage: z.number().nullable().optional(),
  rateLimitBurst: z.number().nullable().optional(),
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Domain = z.infer<typeof domain>;

// ── Webhooks (auto-deploy) ────────────────────────────────────────────────
export const createWebhook = z.object({
  branch: gitBranch.optional(),
  /** Newline/comma-separated globs — deploy only when a changed file matches. */
  watchPaths: z.string().max(4000).optional(),
});
export type CreateWebhookInput = z.input<typeof createWebhook>;

export const webhook = z.object({
  id: z.number().int(),
  branch: z.string(),
  active: z.boolean(),
  watchPaths: z.string(),
  url: z.string(),
  createdAt: z.string().datetime(),
});
export type Webhook = z.infer<typeof webhook>;

/** Returned once at creation time — the secret is never retrievable again. */
export const createdWebhook = webhook.extend({ secret: z.string() });
export type CreatedWebhook = z.infer<typeof createdWebhook>;

// ── Managed databases ─────────────────────────────────────────────────────
export const createDatabase = z.object({
  name: z.string().min(1).max(100),
  engine: z.enum(['postgres', 'mysql', 'mariadb', 'redis', 'mongo', 'valkey', 'clickhouse', 'meilisearch', 'rabbitmq']),
  version: z.string().optional(),
  projectId: z.number().int().optional(),
  existingVolume: z.string().optional(),
  extensions: z.array(z.string()).optional(),
  webGuiEnabled: z.boolean().optional(),
});
export type CreateDatabaseInput = z.input<typeof createDatabase>;

export const databasePatch = z.object({
  name: z.string().min(1).max(100).optional(),
  extensions: z.array(z.string()).optional(),
  webGuiEnabled: z.boolean().optional(),
});
export type DatabasePatch = z.input<typeof databasePatch>;

export const managedDatabase = z.object({
  id: z.number().int(),
  projectId: z.number().int().nullable(),
  name: z.string(),
  slug: z.string(),
  engine: z.string(),
  version: z.string().nullable(),
  status: z.string(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  username: z.string().nullable(),
  database: z.string().nullable(),
  connectionString: z.string().nullable(),
  webGuiEnabled: z.boolean().optional().default(false),
  webGuiPort: z.number().int().nullable().optional(),
  extensions: z.array(z.string()).optional().default([]),
  attachedServices: z.array(z.object({ id: z.number().int(), name: z.string(), slug: z.string() })).optional().default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ManagedDatabase = z.infer<typeof managedDatabase>;

/** Input for attaching a managed database to a service. The env alias, when
 *  provided, must be a valid environment-variable name (trimmed) — it is
 *  injected verbatim into the service's runtime env at deploy time. */
export const createAttachment = z.object({
  databaseId: z.number().int().positive(),
  envAlias: envVarName.optional(),
});
export type CreateAttachmentInput = z.input<typeof createAttachment>;

export const attachment = z.object({
  id: z.number().int(),
  databaseId: z.number().int(),
  envAlias: z.string(),
  database: z.object({ name: z.string(), engine: z.string(), status: z.string() }).nullable(),
});
export type Attachment = z.infer<typeof attachment>;

// ── Environment variables ──────────────────────────────────────────────────
export const upsertEnvVar = z.object({
  key: envVarName.max(100),
  value: z.string(),
  isSecret: z.boolean().optional(),
});
export type UpsertEnvVarInput = z.input<typeof upsertEnvVar>;

export const envVar = z.object({
  id: z.number().int(),
  key: z.string(),
  value: z.string(),
  isSecret: z.boolean(),
});
export type EnvVar = z.infer<typeof envVar>;

// ── Resource limits ───────────────────────────────────────────────────────
export const setLimits = z.object({
  cpuShares: z.number().int().min(0).max(262144).nullable().optional(),
  memLimitMb: z.number().int().min(0).nullable().optional(),
});
export type SetLimitsInput = z.infer<typeof setLimits>;

// ── Monitoring stats ───────────────────────────────────────────────────────
export const hostStat = z.object({
  cpuCores: z.number().int(),
  load1: z.number(),
  memTotalBytes: z.number().int(),
  memUsedBytes: z.number().int(),
  diskTotalBytes: z.number().int(),
  diskUsedBytes: z.number().int(),
});
export type HostStat = z.infer<typeof hostStat>;

export const containerStat = z.object({
  name: z.string(),
  kind: z.enum(['service', 'database']),
  refId: z.number().int(),
  refName: z.string(),
  engine: z.string().optional(),
  cpuPct: z.number(),
  memMb: z.number(),
  memLimitMb: z.number().int(),
});
export type ContainerStat = z.infer<typeof containerStat>;

export const statsSnapshot = z.object({
  host: hostStat.nullable(),
  containers: z.array(containerStat),
});
export type StatsSnapshot = z.infer<typeof statsSnapshot>;

export const metricSeries = z.object({
  kind: z.string(),
  points: z.array(z.object({ ts: z.string().datetime(), value: z.number() })),
});
export type MetricSeries = z.infer<typeof metricSeries>;

// ── Topology graph ─────────────────────────────────────────────────────────
export const topologyGraph = z.object({
  services: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      slug: z.string(),
      type: z.string(),
      status: z.string(),
      image: z.string().nullable(),
      port: z.number().int().nullable(),
      runtimeId: z.string().nullable(),
      volumeMount: z.string().nullable(),
    }),
  ),
  databases: z.array(z.object({ id: z.number().int(), name: z.string(), engine: z.string(), status: z.string(), host: z.string().nullable() })),
  attachments: z.array(z.object({ id: z.number().int(), serviceId: z.number().int(), databaseId: z.number().int(), envAlias: z.string() })),
  domains: z.array(z.object({ id: z.number().int(), serviceId: z.number().int(), hostname: z.string(), ssl: z.boolean() })),
  /** Managed docker volumes with their owner link (null = orphaned). */
  volumes: z.array(
    z.object({
      name: z.string(),
      owner: z.object({ kind: z.string(), refId: z.number().int(), name: z.string(), engine: z.string().optional() }).nullable(),
    }),
  ),
  /** User-defined docker networks; `containers` is filled for the shared mesh only. */
  networks: z.array(z.object({ name: z.string(), driver: z.string(), containers: z.array(z.string()) })),
  /** The Traefik gateway fronting every routed service. */
  gateway: z.object({ name: z.string(), network: z.string(), running: z.boolean() }),
});
export type TopologyGraph = z.infer<typeof topologyGraph>;

// ── Backups + storage ──────────────────────────────────────────────────────
export const backup = z.object({
  id: z.number().int(),
  databaseId: z.number().int().nullable(),
  status: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string().datetime(),
});
export type Backup = z.infer<typeof backup>;

export const backupWithDb = backup.extend({ databaseName: z.string().nullable() });
export type BackupWithDb = z.infer<typeof backupWithDb>;

// ── Template hub ───────────────────────────────────────────────────────────
export const templateSummary = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  category: z.string(),
  emoji: z.string(),
  featured: z.boolean().optional(),
});
export type TemplateSummary = z.infer<typeof templateSummary>;

export const template = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  category: z.string(),
  emoji: z.string(),
  image: z.string(),
  port: z.number().int(),
  volumeMount: z.string().nullable().optional(),
  env: z.array(z.object({ key: z.string(), value: z.string(), secret: z.boolean().optional() })).optional(),
  website: z.string().optional(),
  docs: z.string().optional(),
  featured: z.boolean().optional(),
  /** Human hint about extra setup this template needs (shown in the Hub). */
  requires: z.string().optional(),
  /** When set, the wizard can auto-provision + attach a managed database of
   *  this engine (DATABASE_URL/REDIS_URL injected at deploy time). */
  dbEngine: z.enum(['postgres', 'mysql', 'mariadb', 'redis', 'valkey', 'mongo', 'clickhouse', 'meilisearch', 'rabbitmq']).optional(),
  /** Container command (argv) appended after the image — needed by images
   *  whose default entrypoint prints help and exits (e.g. minio). */
  cmd: z.array(z.string()).min(1).optional(),
  /** Bind-mount the host Docker socket into the container (docker control —
   *  only settable from the admin-controlled template registry, never via
   *  the create-service API). */
  dockerSocket: z.boolean().optional(),
});
export type Template = z.infer<typeof template>;

// ── Domain routing index + volumes ─────────────────────────────────────────
export const domainEntry = z.object({
  id: z.number().int(),
  hostname: z.string(),
  path: z.string(),
  ssl: z.boolean(),
  status: z.string(),
  serviceId: z.number().int(),
  serviceName: z.string().nullable(),
  container: z.string().nullable(),
  port: z.number().int().nullable(),
  certExpiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DomainEntry = z.infer<typeof domainEntry>;

export const volumeEntry = z.object({
  name: z.string(),
  sizeBytes: z.number().int(),
  owner: z.object({ kind: z.string(), id: z.number().int().optional(), name: z.string(), engine: z.string().optional() }).nullable(),
  /** True when the owner's container is running — deletion is refused (409). */
  inUse: z.boolean(),
});
export type VolumeEntry = z.infer<typeof volumeEntry>;

// ── Volume file manager ────────────────────────────────────────────────────
export const volumeFileEntry = z.object({
  name: z.string(),
  type: z.enum(['file', 'dir']),
  sizeBytes: z.number().int(),
  mode: z.string().nullable().optional(),
  modifiedAt: z.string().datetime().nullable(),
});
export type VolumeFileEntry = z.infer<typeof volumeFileEntry>;

export const volumeFileWrite = z.object({
  /** Relative path inside the volume. */
  path: z.string().min(1).max(1024),
  /** Base64-encoded file content (schemas validate; argv never sees it). */
  contentBase64: z.string().max(8 * 1024 * 1024),
});
export type VolumeFileWriteInput = z.input<typeof volumeFileWrite>;

export const volumePathCreate = z.object({
  path: z.string().min(1).max(1024),
});
export type VolumePathCreateInput = z.input<typeof volumePathCreate>;

// ── Container file manager ─────────────────────────────────────────────────
export const containerFileEntry = volumeFileEntry;
export type ContainerFileEntry = VolumeFileEntry;

export const containerFileWrite = volumeFileWrite;
export type ContainerFileWriteInput = VolumeFileWriteInput;

export const containerPathCreate = volumePathCreate;
export type ContainerPathCreateInput = VolumePathCreateInput;

// ── Docker resource accounting ─────────────────────────────────────────────
export const dockerResources = z.object({
  network: z.string(),
  containers: z.number().int(),
  volumes: z.number().int(),
  imagesSummary: z.object({ total: z.string(), active: z.string(), size: z.string(), reclaimable: z.string() }),
  images: z.array(z.object({ repo: z.string(), tag: z.string(), size: z.string() })),
});
export type DockerResources = z.infer<typeof dockerResources>;

// ── Cloudflare Tunnels ─────────────────────────────────────────────────────
export const createTunnel = z.object({ name: z.string().min(1).max(100), token: z.string().min(1) });
export type CreateTunnelInput = z.input<typeof createTunnel>;

export const tunnelEntry = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  containerName: z.string(),
  createdAt: z.string().datetime(),
});
export type TunnelEntry = z.infer<typeof tunnelEntry>;

// ── Log Drains ─────────────────────────────────────────────────────────────
export const logDrainType = z.enum(['syslog', 'loki', 'vector', 'datadog', 'http']);
export type LogDrainType = z.infer<typeof logDrainType>;

export const logDrainFormat = z.enum(['json', 'raw', 'rfc5424']);
export type LogDrainFormat = z.infer<typeof logDrainFormat>;

export const logDrain = z.object({
  id: z.number().int(),
  name: z.string(),
  type: logDrainType,
  url: z.string(),
  serviceId: z.number().int().nullable(),
  serviceName: z.string().nullable().optional(),
  enabled: z.boolean(),
  format: logDrainFormat,
  headers: z.record(z.string(), z.string()).optional(),
  hasApiKey: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LogDrain = z.infer<typeof logDrain>;

export const logDrainCreate = z.object({
  name: z.string().min(1).max(100),
  type: logDrainType,
  url: z.string().min(1),
  apiKey: z.string().optional(),
  serviceId: z.number().int().optional().nullable(),
  enabled: z.boolean().optional(),
  format: logDrainFormat.optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type LogDrainCreateInput = z.input<typeof logDrainCreate>;

export const logDrainUpdate = logDrainCreate.partial();
export type LogDrainUpdateInput = z.input<typeof logDrainUpdate>;

export const logDrainTestResult = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  message: z.string().optional(),
});
export type LogDrainTestResult = z.infer<typeof logDrainTestResult>;

// ── Auto-Prune & Disk Maintenance ──────────────────────────────────────────
export const autoPruneConfig = z.object({
  enabled: z.boolean(),
  thresholdPercent: z.number().min(10).max(99),
  pruneImages: z.boolean(),
  pruneVolumes: z.boolean(),
  pruneContainers: z.boolean(),
  pruneBuildCache: z.boolean(),
  maxAgeHours: z.number().min(1).max(720),
});
export type AutoPruneConfig = z.infer<typeof autoPruneConfig>;

export const autoPruneConfigUpdate = autoPruneConfig.partial();
export type AutoPruneConfigUpdateInput = z.input<typeof autoPruneConfigUpdate>;

export const autoPruneStatus = autoPruneConfig.extend({
  diskUsedPercent: z.number(),
  diskTotalBytes: z.number(),
  diskFreeBytes: z.number(),
  lastPrunedAt: z.string().datetime().nullable(),
  lastFreedBytes: z.number().nullable(),
});
export type AutoPruneStatus = z.infer<typeof autoPruneStatus>;

export const autoPruneRunResult = z.object({
  ok: z.boolean(),
  freedBytes: z.number(),
  diskUsedPercentAfter: z.number(),
  details: z.object({
    imagesFreed: z.string().optional(),
    buildCacheFreed: z.string().optional(),
    containersFreed: z.string().optional(),
    volumesFreed: z.string().optional(),
  }),
});
export type AutoPruneRunResult = z.infer<typeof autoPruneRunResult>;

