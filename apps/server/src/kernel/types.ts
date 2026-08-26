import type { DB, Database, Domain, Service } from '@ninedeploy/db';
import type { config } from '../config.js';

export type AppConfig = typeof config;

export type KernelState = 'INIT' | 'BOOTSTRAP' | 'READY' | 'DRAINING' | 'TERMINATED';

// ─── Domain Events (Asynchronous Pub/Sub) ──────────────────────────────────
export interface DomainEvents {
  // Service lifecycle
  'service.created': { serviceId: number; projectId: number; name: string };
  'service.deploying': { serviceId: number; deployId: number };
  'service.deployed': { serviceId: number; deployId: number; status: 'success' | 'failed' };
  'service.stopped': { serviceId: number };
  'service.deleted': { serviceId: number; name: string };

  // Database lifecycle
  'database.created': { databaseId: number; projectId: number; name: string; engine: string };
  'database.started': { databaseId: number };
  'database.stopped': { databaseId: number };
  'database.deleted': { databaseId: number; name: string; volumeRetained: boolean };
  'database.backup_completed': { databaseId: number; sizeBytes: number; remoteUploaded: boolean };
  'database.backup_failed': { databaseId: number; error: string };

  // Server & Edge Agents
  'server.announced': { serverId: number; name: string; host: string; port: number };
  'server.connected': { serverId: number; host: string };
  'server.disconnected': { serverId: number; reason: string };
  'server.approved': { serverId: number; approvedByUserId: number };
  'server.rejected': { serverId: number };

  // Alerts & Notifications
  'alert.triggered': { title: string; message: string; level: 'info' | 'warn' | 'error'; serviceId?: number };
  'notification.sent': { channelId: number; type: string; success: boolean };
  'notification.queued': { title: string; body: string; level: 'info' | 'warn' | 'error' };

  // Configuration & Plugins
  'config.changed': { key: string; isSecret: boolean; pluginId: string | null };
  'plugin.registered': { pluginId: string; version: string };
  'plugin.status_changed': { pluginId: string; status: 'active' | 'disabled' | 'errored' };
  'plugin.reloaded': { pluginId: string; status: 'active' | 'disabled' | 'errored' };

  // Plugin Ecosystem Events
  'deployment.status_changed': { deploymentId?: number; status?: string; serviceName?: string };
  'service.health_changed': { serviceId?: number; status?: string };
  'backup.completed': { databaseId?: number; sizeBytes?: number };
  'tunnel.route_evaluated': { serviceId?: number; domain?: string };
  'telemetry.recorded': { sourceEvent: string; timestamp: string; data: unknown };
  'custom.system_event': Record<string, unknown>;
}

// ─── Sequential Hook Definitions (Synchronous Interceptors) ────────────────
export interface HookDefinitions {
  // Deploy pipeline hooks
  'deploy:before': { service: Service; targetCommit?: string };
  'deploy:build_complete': { service: Service; imageTag: string; durationMs: number };
  'deploy:healthcheck': { service: Service; containerId: string; healthy: boolean };
  'deploy:after': { service: Service; deployId: number; success: boolean };
  'deploy.after': { serviceId?: number; domain?: string };

  // Database safety hooks
  'database:before_delete': { database: Database; allowOrAbort: boolean; reason?: string };
  'database:after_create': { database: Database; volumeName: string };

  // Proxy & Route hooks
  'proxy:sync_routes': { domains: Domain[]; services: Service[] };

  // Server announce hook
  'server:before_announce': { name: string; host?: string; port: number; token: string };
}

// ─── Event Bus Interface ───────────────────────────────────────────────────
export interface IEventBus {
  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void;
  emitCustom(event: string, payload: unknown): void;
  on<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => Promise<void> | void): () => void;
  onCustom(event: string, listener: (payload: unknown) => Promise<void> | void): () => void;
  once<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => Promise<void> | void): () => void;
  listenerCount(event: string): number;
  removeAllListeners(event?: string): void;
}

// ─── Hook Pipeline Interface ───────────────────────────────────────────────
export interface IHookPipeline {
  tap<K extends keyof HookDefinitions>(
    hook: K,
    handler: (payload: HookDefinitions[K], ctx: KernelContext) => Promise<undefined | HookDefinitions[K]>,
    opts?: { priority?: number; id?: string; timeoutMs?: number },
  ): () => void;
  call<K extends keyof HookDefinitions>(hook: K, payload: HookDefinitions[K]): Promise<HookDefinitions[K]>;
  hasListeners(hook: string): boolean;
  clear(): void;
}

// ─── Service & Driver Registry ─────────────────────────────────────────────
export interface IServiceRegistry {
  register<T>(name: string, service: T): void;
  get<T>(name: string): T;
  getOptional<T>(name: string): T | undefined;
  has(name: string): boolean;
  unregister(name: string): boolean;
  clear(): void;

  registerCompute(driver: IComputeDriver): void;
  getCompute(name: string): IComputeDriver | undefined;
  registerProxy(driver: IProxyDriver): void;
  getProxy(name: string): IProxyDriver | undefined;
  registerStorage(driver: IStorageDriver): void;
  getStorage(name: string): IStorageDriver | undefined;
}

// ─── Configuration Center (Dual-Vault: Public & Secrets) ───────────────────
export interface ConfigDefinition<T = unknown> {
  key: string;
  pluginId?: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  isSecret: boolean;
  label: string;
  description?: string;
  category?: string;
  tags?: string[];
  defaultValue?: T;
  options?: string[];
  required?: boolean;
}

export interface IScopedConfig {
  get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  getSecret(key: string): Promise<string | null>;
  set<T = unknown>(key: string, value: T, opts?: { isSecret?: boolean; description?: string; tags?: string[] }): Promise<void>;
  watch(key: string, callback: (newVal: unknown) => void): () => void;
}

export interface IConfigCenter {
  registerDefinition(def: ConfigDefinition): void;
  getDefinition(key: string): ConfigDefinition | undefined;
  listDefinitions(category?: string, pluginId?: string): ConfigDefinition[];
  get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  getSecret(key: string): Promise<string | null>;
  set<T = unknown>(
    key: string,
    value: T,
    opts?: { isSecret?: boolean; category?: string; pluginId?: string; description?: string; tags?: string[]; userId?: number },
  ): Promise<void>;
  delete(key: string): Promise<boolean>;
  watch(key: string, callback: (newVal: unknown) => void): () => void;
  purgePluginConfigs(pluginId: string): Promise<number>;
  createScopedConfig(pluginId: string): IScopedConfig;
}

// ─── Menu & Navigation Registry ────────────────────────────────────────────
export type MenuSlot =
  | 'sidebar:main'
  | 'sidebar:secondary'
  | 'service:tabs'
  | 'database:tabs'
  | 'settings:nav'
  | 'command:palette'
  | 'user:menu';

export interface MenuItemDefinition {
  id: string;
  pluginId?: string;
  slot: MenuSlot;
  label: string;
  route: string;
  icon?: string;
  order?: number;
  badge?: {
    text: string;
    variant?: 'default' | 'success' | 'warning' | 'info';
  };
  permission?: 'admin' | 'member';
}

export interface IMenuRegistry {
  registerMenuItem(item: MenuItemDefinition): () => void;
  unregisterMenuItem(id: string): boolean;
  /**
   * @param isOperator true when the caller is owner/admin in at least one
   * workspace. Replaces the legacy `userRole: 'admin' | 'member'` parameter
   * — the global role enum is gone, plugin menu gating now keys off the
   * boolean operator flag.
   */
  getItemsForSlot(slot: MenuSlot, isOperator?: boolean): MenuItemDefinition[];
  getAllItems(): MenuItemDefinition[];
  getPluginMenus(pluginId: string): MenuItemDefinition[];
  purgePluginMenus(pluginId: string): number;
}

// ─── Compute, Proxy & Storage Driver Interfaces ────────────────────────────
export interface IComputeDriver {
  readonly name: string;
  pullImage(image: string, onLog: (l: string) => void): Promise<void>;
  runContainer(opts: { name: string; image: string; network?: string; envFile?: string; volume?: string; mount?: string; cpuShares?: string; memLimitMb?: string }): Promise<void>;
  stopContainer(name: string, timeoutSec?: number): Promise<void>;
  removeContainer(name: string): Promise<void>;
  inspectContainer(name: string): Promise<{ status: string; ipAddress?: string; image?: string }>;
  getLogs(name: string, tail?: number): Promise<string[]>;
}

export interface IProxyDriver {
  readonly name: string;
  syncConfiguration(domains: Domain[], services: Service[]): Promise<void>;
  reload(): Promise<void>;
  getCertificateStatus(): Promise<Array<{ domain: string; valid: boolean; expiresAt?: string }>>;
}

export interface IStorageDriver {
  readonly name: string;
  upload(localPath: string, remoteKey: string): Promise<void>;
  download(remoteKey: string, localDestPath: string): Promise<void>;
  delete(remoteKey: string): Promise<void>;
}

// ─── Kernel Plugin & Context ───────────────────────────────────────────────
export interface KernelPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly icon?: string;
  readonly isOfficial?: boolean;
  readonly dependencies?: string[];
  readonly configSchema?: ConfigDefinition[];
  readonly menuItems?: MenuItemDefinition[];

  init(ctx: KernelContext): Promise<void> | void;
  onReady?(ctx: KernelContext): Promise<void> | void;
  onShutdown?(ctx: KernelContext): Promise<void> | void;
  destroy?(ctx: KernelContext): Promise<void> | void;
}

export interface KernelContext {
  readonly state: KernelState;
  readonly db: DB;
  readonly config: AppConfig;
  readonly events: IEventBus;
  readonly hooks: IHookPipeline;
  readonly registry: IServiceRegistry;
  readonly configCenter: IConfigCenter;
  readonly menuRegistry: IMenuRegistry;

  registerPlugin(plugin: KernelPlugin): Promise<void>;
  unregisterPlugin(id: string): Promise<boolean>;
  getPlugin(id: string): KernelPlugin | undefined;
  listPlugins(): KernelPlugin[];
  boot(): Promise<void>;
  shutdown(): Promise<void>;
}
