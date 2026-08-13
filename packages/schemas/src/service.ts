import { z } from 'zod';
import { slug } from './common.js';

export const serviceType = z.enum(['pm2', 'docker']);
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
  cpuShares: z.number().int().min(0).max(262144).optional(),
  memLimitMb: z.number().int().min(0).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  build: z
    .object({
      buildPack: buildPack.default('auto'),
      baseDir: z.string().default('/'),
      installCmd: z.string().optional(),
      buildCmd: z.string().optional(),
      startCmd: z.string().optional(),
      dockerfilePath: z.string().optional(),
    })
    .default({ buildPack: 'auto', baseDir: '/' }),
});
export type CreateService = z.infer<typeof createService>;

export const updateService = createService.partial();
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
  commitSha: z.string().nullable(),
  port: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Service = z.infer<typeof service>;

// ── Sources (private repo credentials) ─────────────────────────────────────
export const createSource = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['github', 'gitlab', 'gitea', 'custom']),
  token: z.string().optional(),
  deployKey: z.string().optional(),
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
  ssl: z.boolean().default(false),
});
export type CreateDomainInput = z.input<typeof createDomain>;

export const domain = z.object({
  id: z.number().int(),
  serviceId: z.number().int(),
  hostname: z.string(),
  path: z.string(),
  ssl: z.boolean(),
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Domain = z.infer<typeof domain>;

// ── Webhooks (auto-deploy) ────────────────────────────────────────────────
export const createWebhook = z.object({ branch: z.string().min(1).optional() });
export type CreateWebhookInput = z.input<typeof createWebhook>;

export const webhook = z.object({
  id: z.number().int(),
  branch: z.string(),
  active: z.boolean(),
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
  engine: z.enum(['postgres', 'mysql', 'redis', 'mongo']),
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

export const attachment = z.object({
  id: z.number().int(),
  databaseId: z.number().int(),
  envAlias: z.string(),
  database: z.object({ name: z.string(), engine: z.string(), status: z.string() }).nullable(),
});
export type Attachment = z.infer<typeof attachment>;

// ── Environment variables ──────────────────────────────────────────────────
export const upsertEnvVar = z.object({
  key: z.string().min(1).max(100),
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
  points: z.array(z.object({ ts: z.string().datetime(), value: z.number().int() })),
});
export type MetricSeries = z.infer<typeof metricSeries>;

// ── Topology graph ─────────────────────────────────────────────────────────
export const topologyGraph = z.object({
  services: z.array(z.object({ id: z.number().int(), name: z.string(), slug: z.string(), type: z.string(), status: z.string() })),
  databases: z.array(z.object({ id: z.number().int(), name: z.string(), engine: z.string(), status: z.string() })),
  attachments: z.array(z.object({ id: z.number().int(), serviceId: z.number().int(), databaseId: z.number().int(), envAlias: z.string() })),
  domains: z.array(z.object({ id: z.number().int(), serviceId: z.number().int(), hostname: z.string() })),
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
  featured: z.boolean().optional(),
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DomainEntry = z.infer<typeof domainEntry>;

export const volumeEntry = z.object({
  name: z.string(),
  sizeBytes: z.number().int(),
  owner: z.object({ kind: z.string(), name: z.string(), engine: z.string().optional() }).nullable(),
});
export type VolumeEntry = z.infer<typeof volumeEntry>;

// ── Docker resource accounting ─────────────────────────────────────────────
export const dockerResources = z.object({
  network: z.string(),
  containers: z.number().int(),
  volumes: z.number().int(),
  imagesSummary: z.object({ total: z.string(), active: z.string(), size: z.string(), reclaimable: z.string() }),
  images: z.array(z.object({ repo: z.string(), tag: z.string(), size: z.string() })),
});
export type DockerResources = z.infer<typeof dockerResources>;
