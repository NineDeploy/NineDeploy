import { z } from 'zod';

// ─── Configuration Center Schemas ───────────────────────────────────────────
export const configItemSchema = z.object({
  key: z.string(),
  pluginId: z.string().nullable().optional(),
  type: z.enum(['string', 'number', 'boolean', 'enum', 'json']).default('string'),
  isSecret: z.boolean(),
  label: z.string(),
  category: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  options: z.array(z.string()).optional(),
  value: z.unknown(),
  isConfigured: z.boolean(),
  updatedAt: z.string().optional(),
});
export type ConfigItem = z.infer<typeof configItemSchema>;

export const configListSchema = z.object({
  entries: z.array(configItemSchema),
});
export type ConfigListResponse = z.infer<typeof configListSchema>;

export const setConfigSchema = z.object({
  value: z.unknown(),
  isSecret: z.boolean().optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).optional(),
});
export type SetConfigInput = z.infer<typeof setConfigSchema>;

// ─── Plugin Ecosystem Schemas ───────────────────────────────────────────────
export const pluginItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  icon: z.string().optional(),
  isOfficial: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(['active', 'disabled', 'errored', 'installing']),
  configSchema: z.array(z.record(z.string(), z.unknown())).optional(),
  menuItems: z.array(z.record(z.string(), z.unknown())).optional(),
  dependencies: z.array(z.string()).optional(),
  error: z.string().optional(),
  installedAt: z.string().optional(),
});
export type PluginItem = z.infer<typeof pluginItemSchema>;

export const pluginListSchema = z.object({
  plugins: z.array(pluginItemSchema),
});
export type PluginListResponse = z.infer<typeof pluginListSchema>;

export const installPluginSchema = z.object({
  source: z.enum(['marketplace', 'npm', 'git', 'local']).default('marketplace'),
  target: z.string().min(1),
  name: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  icon: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  configSchema: z.array(z.record(z.string(), z.unknown())).optional(),
  menuItems: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type InstallPluginInput = z.infer<typeof installPluginSchema>;

export const marketplacePluginItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  icon: z.string().optional(),
  category: z.string(),
  isOfficial: z.boolean(),
  isInstalled: z.boolean().default(false),
  dependencies: z.array(z.string()).optional(),
  configSchema: z.array(z.record(z.string(), z.unknown())).optional(),
  menuItems: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type MarketplacePluginItem = z.infer<typeof marketplacePluginItemSchema>;

export const marketplaceCatalogSchema = z.object({
  catalog: z.array(marketplacePluginItemSchema),
});
export type MarketplaceCatalogResponse = z.infer<typeof marketplaceCatalogSchema>;

// ─── Menu & Navigation Schemas ──────────────────────────────────────────────
export const menuItemSchema = z.object({
  id: z.string(),
  pluginId: z.string().optional(),
  slot: z.string(),
  label: z.string(),
  route: z.string(),
  icon: z.string().optional(),
  order: z.number().optional(),
  permission: z.enum(['admin', 'member']).optional(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const menuListSchema = z.object({
  slots: z.record(z.string(), z.array(menuItemSchema)),
  items: z.array(menuItemSchema),
});
export type MenuListResponse = z.infer<typeof menuListSchema>;

export const pluginInspectSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  isOfficial: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(['active', 'disabled', 'errored', 'installing']),
  dependencies: z.array(z.string()),
  hooks: z.array(z.string()),
  services: z.array(z.string()),
  menus: z.array(menuItemSchema),
  configSchema: z.array(z.record(z.string(), z.unknown())),
  error: z.string().nullable().optional(),
  installedAt: z.string().optional(),
  runtimeStats: z.object({
    eventsHandled: z.number(),
    uptimeSeconds: z.number(),
    loadedAt: z.string().optional(),
  }),
});
export type PluginInspectResponse = z.infer<typeof pluginInspectSchema>;

