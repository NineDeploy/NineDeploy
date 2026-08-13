import { z } from 'zod';
import { slug } from './common.js';

export const serviceType = z.enum(['pm2', 'docker']);
export const buildPack = z.enum(['auto', 'nixpacks', 'dockerfile']);

export const createService = z.object({
  projectId: z.number().int().positive().optional(),
  name: z.string().min(1).max(100),
  slug: slug.optional(), // derived from name if omitted
  type: serviceType.default('docker'),
  repoUrl: z.url(),
  branch: z.string().min(1).max(200).default('main'),
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
  repoUrl: z.string(),
  branch: z.string(),
  commitSha: z.string().nullable(),
  port: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Service = z.infer<typeof service>;

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
