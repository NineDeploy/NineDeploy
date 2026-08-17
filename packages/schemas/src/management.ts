import { z } from 'zod';

/**
 * Zod schemas for management/admin endpoints that previously used ad-hoc
 * `as { ... }` casts. Centralising them gives consistent 400 validation errors.
 */

export const rolePatch = z.object({
  role: z.enum(['admin', 'member']),
});
export type RolePatch = z.infer<typeof rolePatch>;

// ── Update check (admin) ───────────────────────────────────────────────────
export const updateCheckResult = z.object({
  current: z.string(),
  /** null when the feed was unreachable or checks are disabled. */
  latest: z.string().nullable(),
  /** null = unknown; otherwise true when latest > current. */
  updateAvailable: z.boolean().nullable(),
  notesUrl: z.string().nullable(),
  checkedAt: z.string().datetime(),
});
export type UpdateCheckResult = z.infer<typeof updateCheckResult>;

export const webhookCreate = z.object({
  branch: z.string().max(255).optional(),
  /** Newline/comma-separated globs — deploy only when a changed file matches. */
  watchPaths: z.string().max(4000).optional(),
});
export type WebhookCreate = z.infer<typeof webhookCreate>;

export const sourcePatch = z.object({
  name: z.string().min(1).max(100).optional(),
  token: z.string().max(4096).optional(),
  deployKey: z.string().max(16384).optional(),
  registryUsername: z.string().max(255).optional(),
  defaultBranch: z.string().max(255).optional(),
});
export type SourcePatch = z.infer<typeof sourcePatch>;

export const notificationType = z.enum(['telegram', 'webhook', 'discord', 'slack', 'ntfy', 'email']);

export const notificationChannelCreate = z.object({
  name: z.string().min(1).max(100),
  type: notificationType,
  target: z.string().min(1).max(2048),
  eventFilter: z.string().max(1000).optional(),
});
export type NotificationChannelCreate = z.infer<typeof notificationChannelCreate>;

export const notificationChannelPatch = z.object({
  name: z.string().min(1).max(100).optional(),
  target: z.string().min(1).max(2048).optional(),
  eventFilter: z.string().max(1000).optional(),
  active: z.boolean().optional(),
});
export type NotificationChannelPatch = z.infer<typeof notificationChannelPatch>;

export const alertMetricEnum = z.enum(['cpu', 'memory', 'cert-expiry']);
export const alertOperatorEnum = z.enum(['>', '<']);

export const alertRuleCreate = z
  .object({
    name: z.string().min(1).max(100),
    serviceId: z.number().int().positive().nullable().optional(),
    metric: alertMetricEnum,
    operator: alertOperatorEnum.default('>'),
    threshold: z.number().int(),
    durationWindows: z.number().int().min(1).max(120).default(1),
    enabled: z.boolean().default(true),
  })
  // Certificate expiry is tracked per HOST (the collector samples the ACME
  // store), so a service-scoped rule could never evaluate.
  .refine((r) => r.metric !== 'cert-expiry' || !r.serviceId, {
    message: 'cert-expiry rules are host-wide (omit serviceId)',
    path: ['serviceId'],
  });
export type AlertRuleCreate = z.infer<typeof alertRuleCreate>;

export const alertRulePatch = z
  .object({
    name: z.string().min(1).max(100).optional(),
    serviceId: z.number().int().positive().nullable().optional(),
    metric: alertMetricEnum.optional(),
    operator: alertOperatorEnum.optional(),
    threshold: z.number().int().optional(),
    durationWindows: z.number().int().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((r) => r.metric !== 'cert-expiry' || !r.serviceId, {
    message: 'cert-expiry rules are host-wide (omit serviceId)',
    path: ['serviceId'],
  });
export type AlertRulePatch = z.infer<typeof alertRulePatch>;

// ── Backup destinations (admin) ────────────────────────────────────────────
/**
 * Blank region/prefix fall back to the documented defaults (pre-schema
 * behaviour); the endpoint must be an http(s) URL.
 */
export const backupDestinationCreate = z.object({
  name: z.string().trim().min(1).max(100),
  endpoint: z.string().trim().regex(/^https?:\/\//, 'endpoint must be an http(s) URL'),
  region: z.string().trim().optional().transform((v) => v || 'us-east-1'),
  bucket: z.string().trim().min(1).max(255),
  prefix: z.string().trim().optional().transform((v) => v || 'ninedeploy'),
  accessKeyId: z.string().trim().min(1).max(255),
  secretAccessKey: z.string().min(1).max(4096),
});
export type BackupDestinationCreate = z.infer<typeof backupDestinationCreate>;

/**
 * All fields optional; blank strings are accepted here and skipped by the
 * route (patching e.g. `name: " "` is a no-op, not an error).
 */
export const backupDestinationPatch = z.object({
  name: z.string().max(100).optional(),
  endpoint: z.string().max(2048).optional(),
  region: z.string().max(100).optional(),
  bucket: z.string().max(255).optional(),
  prefix: z.string().max(255).optional(),
  accessKeyId: z.string().max(255).optional(),
  secretAccessKey: z.string().max(4096).optional(),
  active: z.boolean().optional(),
});
export type BackupDestinationPatch = z.infer<typeof backupDestinationPatch>;

// ── Remote servers (admin) ─────────────────────────────────────────────────
/**
 * `host` is a bare hostname (or IP) or host:port. A non-numeric port falls
 * back to the default 4600 (pre-schema behaviour); an out-of-range one is
 * rejected.
 */
export const serverCreate = z.object({
  name: z.string().trim().min(1).max(100),
  host: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?$/, 'host must be a hostname or host:port'),
  port: z
    .unknown()
    .optional()
    .transform((v) => Number(v ?? 4600) || 4600)
    .pipe(z.number().int().min(1).max(65535)),
});
export type ServerCreate = z.infer<typeof serverCreate>;

export const serverAnnounce = z.object({
  name: z.string().trim().min(1).max(100),
  host: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?$/, 'host must be a hostname or host:port')
    .optional(),
  port: z
    .unknown()
    .optional()
    .transform((v) => Number(v ?? 4600) || 4600)
    .pipe(z.number().int().min(1).max(65535)),
  token: z.string().trim().min(16).max(256),
});
export type ServerAnnounce = z.infer<typeof serverAnnounce>;

// ── Scheduled jobs ─────────────────────────────────────────────────────────
/**
 * The cron expression itself is validated with croner at the route (the
 * schema package has no cron dependency); a non-string `command` is ignored
 * (empty string) as before.
 */
export const jobCreate = z.object({
  name: z.string().trim().min(1).max(100),
  cron: z.string().trim().min(1).max(120),
  kind: z.enum(['deploy', 'exec']).default('deploy'),
  command: z.unknown().optional().transform((v) => (typeof v === 'string' ? v.trim() : '')),
  enabled: z.unknown().optional().transform((v) => v !== false),
});
export type JobCreate = z.infer<typeof jobCreate>;

/** Blank strings are accepted and treated as "no change"/cleared by the route. */
export const jobPatch = z.object({
  name: z.string().optional(),
  cron: z.string().optional(),
  kind: z.enum(['deploy', 'exec']).optional(),
  command: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type JobPatch = z.infer<typeof jobPatch>;

// ── Metrics query ──────────────────────────────────────────────────────────
/**
 * Query params arrive as strings: any `kind` other than "memory" reads as
 * "cpu", and an unusable `minutes` falls back to 60 (clamped to 1..1440).
 */
export const metricQuery = z.object({
  kind: z.string().optional().transform((k) => (k === 'memory' ? 'memory' : 'cpu')),
  minutes: z
    .unknown()
    .optional()
    .transform((v) => Math.min(Math.max(Number(v ?? 60) || 60, 1), 1440)),
});
export type MetricQuery = z.infer<typeof metricQuery>;

/** Serialized alert rule as returned by GET/PATCH /v1/alerts. */
export interface AlertRule {
  id: number;
  serviceId: number | null;
  name: string;
  metric: 'cpu' | 'memory' | 'cert-expiry';
  operator: '>' | '<';
  threshold: number;
  durationWindows: number;
  enabled: boolean;
  status: 'ok' | 'breaching' | 'firing';
  lastValue: number | null;
  firedAt: string | null;
  createdAt: string;
}

/** Input for creating an alert rule — defaults optional (zod applies them server-side). */
export type CreateAlertRuleInput = z.input<typeof alertRuleCreate>;

/** One audit-log entry (activity feed). `meta` carries request context (ip/ua). */
export interface ActivityEntry {
  id: number;
  userId: number | null;
  action: string;
  entity: string | null;
  meta: Record<string, unknown> | null;
  ts: string;
}
