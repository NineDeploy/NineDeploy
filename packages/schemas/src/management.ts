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
