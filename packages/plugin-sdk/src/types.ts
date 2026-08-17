export type MenuSlot =
  | 'sidebar:main'
  | 'sidebar:secondary'
  | 'service:tabs'
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
  permission?: 'admin' | 'member';
}

export interface ConfigSchemaDefinition<T = unknown> {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  isSecret: boolean;
  label: string;
  category?: string;
  description?: string;
  tags?: string[];
  options?: string[];
  defaultValue?: T;
  required?: boolean;
}

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface ScopedConfigAccessor {
  get<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  getSecret(key: string): Promise<string | null>;
  set(
    key: string,
    value: unknown,
    options?: { isSecret?: boolean; description?: string; tags?: string[] },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginContext {
  pluginId: string;
  config: ScopedConfigAccessor;
  logger: PluginLogger;
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: unknown) => void | Promise<void>): () => void;
  tapHook(hookName: string, fn: (context: unknown) => unknown | Promise<unknown>, priority?: number): () => void;
  registerMenuItem(item: Omit<MenuItemDefinition, 'pluginId'>): void;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  isOfficial?: boolean;
  dependencies?: string[];
  configSchema?: ConfigSchemaDefinition[];
  menuItems?: Omit<MenuItemDefinition, 'pluginId'>[];

  init?(ctx: PluginContext): Promise<void> | void;
  start?(ctx: PluginContext): Promise<void> | void;
  stop?(ctx: PluginContext): Promise<void> | void;
  destroy?(ctx: PluginContext): Promise<void> | void;
}
