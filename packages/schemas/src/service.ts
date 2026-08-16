import { z } from 'zod';
import { envVarName, slug } from './common.js';

export const serviceType = z.enum(['pm2', 'docker', 'compose']);
export const buildPack = z.enum(['auto', 'nixpacks', 'dockerfile']);

export const createService = z.object({
  projectId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100),
  slug: slug.optional(), // derived from name if omitted
  type: serviceType.default('docker'),
  repoUrl: z.url().optional(),
  branch: z.string().min(1).max(200).default('main'),
  sourceId: z.number().int().positive().optional(),
  image: z.string().optional(),
  volumeMount: z.string().optional(),
  /** Compose deploys: the main service in the compose file (health/routing
   * target). Defaults to the service slug when omitted. */
  composeService: z.string().min(1).max(200).optional(),
  cpuShares: z.number().int().min(0).max(262144).optional(),
  memLimitMb: z.number().int().min(0).optional(),
  healthPath: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  build: z
    .object({
      buildPack: buildPack.default('auto'),
      baseDir: z.string().default('/'),
      installCmd: z.string().optional(),
      buildCmd: z.string().optional(),
      startCmd: z.string().optional(),
      dockerfilePath: z.string().optional(),
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
  repoUrl: z.url().optional(),
  branch: z.string().min(1).max(200).optional(),
  sourceId: z.number().int().positive().optional(),
  image: z.string().optional(),
  volumeMount: z.string().optional(),
  composeService: z.string().min(1).max(200).optional(),
  cpuShares: z.number().int().min(0).max(262144).optional(),
  memLimitMb: z.number().int().min(0).optional(),
  healthPath: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  build: z
    .object({
      buildPack: buildPack.optional(),
      baseDir: z.string().optional(),
      installCmd: z.string().optional(),
      buildCmd: z.string().optional(),
      startCmd: z.string().optional(),
      dockerfilePath: z.string().optional(),
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
  cpuShares: z.number().int(),
  memLimitMb: z.number().int(),
  build: z
    .object({
      buildPack: buildPack,
      baseDir: z.string(),
      installCmd: z.string().nullable(),
      buildCmd: z.string().nullable(),
      startCmd: z.string().nullable(),
      dockerfilePath: z.string().nullable(),
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
});
export type CreateDomainInput = z.input<typeof createDomain>;

/** PATCHable routing extras for an existing domain. */
export const domainPatch = z.object({
  ssl: z.boolean().optional(),
  redirectWww: z.boolean().optional(),
  headers: z.string().max(8000).optional(),
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
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Domain = z.infer<typeof domain>;

// ── Webhooks (auto-deploy) ────────────────────────────────────────────────
export const createWebhook = z.object({
  branch: z.string().min(1).optional(),
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
  engine: z.enum(['postgres', 'mysql', 'mariadb', 'redis', 'mongo']),
  version: z.string().optional(),
  projectId: z.number().int().optional(),
});
export type CreateDatabaseInput = z.input<typeof createDatabase>;

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
  cpuShares: z.number().int().min(0).max(262144).optional(),
  memLimitMb: z.number().int().min(0).optional(),
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
  dbEngine: z.enum(['postgres', 'mysql', 'redis', 'mongo']).optional(),
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
  owner: z.object({ kind: z.string(), name: z.string(), engine: z.string().optional() }).nullable(),
  /** True when the owner's container is running — deletion is refused (409). */
  inUse: z.boolean(),
});
export type VolumeEntry = z.infer<typeof volumeEntry>;

// ── Volume file manager ────────────────────────────────────────────────────
export const volumeFileEntry = z.object({
  name: z.string(),
  type: z.enum(['file', 'dir']),
  sizeBytes: z.number().int(),
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
