import { z } from 'zod';

/**
 * Zod schemas for management/admin endpoints that previously used ad-hoc
 * `as { ... }` casts. Centralising them gives consistent 400 validation errors.
 */

export const rolePatch = z.object({
  role: z.enum(['admin', 'member']),
});
export type RolePatch = z.infer<typeof rolePatch>;

export const webhookCreate = z.object({
  branch: z.string().max(255).optional(),
});
export type WebhookCreate = z.infer<typeof webhookCreate>;

export const sourcePatch = z.object({
  name: z.string().min(1).max(100).optional(),
  token: z.string().max(4096).optional(),
  deployKey: z.string().max(16384).optional(),
  defaultBranch: z.string().max(255).optional(),
});
export type SourcePatch = z.infer<typeof sourcePatch>;

export const notificationType = z.enum(['telegram', 'webhook', 'discord']);

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
