import { z } from 'zod';
import type { NineDeployClient } from '@ninedeploy/sdk';

/**
 * The MCP tool surface: read-only inspection plus a handful of guarded actions
 * (deploy, cancel, restart, rollback). Every tool maps 1:1 onto the typed SDK,
 * so the MCP wire can never express anything the HTTP API could not, and API
 * token scopes still gate every write (`plugins/auth.ts`).
 *
 * `cancel_deploy` is deliberately paired with `deploy_service`: an agent that
 * can start a build must be able to stop one, or a runaway deploy it triggered
 * can only be halted from a browser.
 */

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodTypeAny;
  handler: (client: NineDeployClient, input: unknown) => Promise<unknown>;
}

const serviceId = z.object({ serviceId: z.number().int().positive() });
const entityOpt = z.object({ entity: z.string().optional() });

export const TOOLS: ToolDef[] = [
  {
    name: 'list_services',
    description: 'List all deployed services with status, type and branch. Optionally scope to a project.',
    input: z.object({ projectId: z.number().int().positive().optional() }),
    handler: (c, input) => {
      const { projectId } = input as { projectId?: number };
      return c.services.list(projectId != null ? `?projectId=${projectId}` : '');
    },
  },
  {
    name: 'get_service',
    description: 'Get one service in full detail (build config, limits, runtime).',
    input: serviceId,
    handler: (c, input) => c.services.get((input as { serviceId: number }).serviceId),
  },
  {
    name: 'service_logs',
    description: 'Read the recent runtime logs of a service.',
    input: serviceId,
    handler: (c, input) => c.services.logs((input as { serviceId: number }).serviceId),
  },
  {
    name: 'list_deploys',
    description: 'Deployment history of a service (status, commit, trigger).',
    input: serviceId,
    handler: (c, input) => c.deploys.list((input as { serviceId: number }).serviceId),
  },
  {
    name: 'list_domains',
    description: 'All routed domains across services, with SSL and status.',
    input: z.object({}),
    handler: (c) => c.domains.all(),
  },
  {
    name: 'list_databases',
    description: 'Managed databases with engine and status.',
    input: z.object({}),
    handler: (c) => c.databases.list(),
  },
  {
    name: 'list_projects',
    description: 'Projects with service/database counts.',
    input: z.object({}),
    handler: (c) => c.projects.list(),
  },
  {
    name: 'list_alerts',
    description: 'Configured alert rules (cpu, memory, cert-expiry).',
    input: z.object({}),
    handler: (c) => c.alerts.list(),
  },
  {
    name: 'activity_log',
    description: 'Recent audit activity; optionally filter by entity name.',
    input: entityOpt,
    handler: (c, input) => c.activity.list({ entity: (input as { entity?: string }).entity }),
  },
  {
    name: 'system_stats',
    description: 'Live host + per-container resource snapshot.',
    input: z.object({}),
    handler: (c) => c.stats.snapshot(),
  },
  {
    name: 'topology',
    description: 'The domains → services → databases routing graph.',
    input: z.object({}),
    handler: (c) => c.topology.get(),
  },
  {
    name: 'health',
    description: 'NineDeploy instance health (API + DB).',
    input: z.object({}),
    handler: (c) => c.health(),
  },
  // ── Actions (mutating) ─────────────────────────────────────────────────
  {
    name: 'deploy_service',
    description: 'Trigger a new deployment for a service. Returns the deployment id.',
    input: serviceId,
    handler: (c, input) => c.deploys.trigger((input as { serviceId: number }).serviceId),
  },
  {
    name: 'restart_service',
    description: 'Restart a running service runtime.',
    input: serviceId,
    handler: (c, input) => c.services.restart((input as { serviceId: number }).serviceId),
  },
  {
    name: 'cancel_deploy',
    description:
      'Cancel a queued or in-flight deployment. A queued deployment stops immediately; an in-flight one stops at the next pipeline step boundary, leaving the previous version serving.',
    input: z.object({ serviceId: z.number().int().positive(), deploymentId: z.number().int().positive() }),
    handler: (c, input) => {
      const { serviceId, deploymentId } = input as { serviceId: number; deploymentId: number };
      return c.deploys.cancel(serviceId, deploymentId);
    },
  },
  {
    name: 'rollback_deploy',
    description: 'Roll a service back to a previous deployment (by deployment id).',
    input: z.object({ serviceId: z.number().int().positive(), deploymentId: z.number().int().positive() }),
    handler: (c, input) => {
      const { serviceId, deploymentId } = input as { serviceId: number; deploymentId: number };
      return c.deploys.rollback(serviceId, deploymentId);
    },
  },
  // ── Plugins & Microkernel Extensibility ────────────────────────────────
  {
    name: 'list_plugins',
    description: 'List all installed and active kernel plugins, extensions, and their operational status.',
    input: z.object({}),
    handler: (c) => c.plugins.list(),
  },
  {
    name: 'marketplace_plugins',
    description: 'Get verified plugins and extensions from the official NineDeploy Marketplace catalog.',
    input: z.object({}),
    handler: (c) => c.plugins.marketplace(),
  },
  {
    name: 'install_plugin',
    description: 'Install a new plugin from the marketplace, NPM registry, Git repository or local manifest.',
    input: z.object({
      source: z.enum(['marketplace', 'npm', 'git', 'local']).default('marketplace'),
      target: z.string(),
      name: z.string().optional(),
      version: z.string().optional(),
      description: z.string().optional(),
    }),
    handler: (c, input) => c.plugins.install(input as any),
  },
  {
    name: 'enable_plugin',
    description: 'Enable an installed plugin in the microkernel runtime.',
    input: z.object({ id: z.string() }),
    handler: (c, input) => c.plugins.enable((input as { id: string }).id),
  },
  {
    name: 'disable_plugin',
    description: 'Disable a plugin and temporarily unload its runtime hooks and menu integrations.',
    input: z.object({ id: z.string() }),
    handler: (c, input) => c.plugins.disable((input as { id: string }).id),
  },
  {
    name: 'uninstall_plugin',
    description: 'Uninstall a plugin, destroying its runtime resources and purging its registered menus/schemas.',
    input: z.object({ id: z.string() }),
    handler: (c, input) => c.plugins.uninstall((input as { id: string }).id),
  },
  // ── Configuration Center ───────────────────────────────────────────────
  {
    name: 'list_configs',
    description: 'List all configuration entries, scoped plugin configs, and system environment tokens.',
    input: z.object({
      category: z.string().optional(),
      pluginId: z.string().optional(),
      reveal: z.boolean().optional(),
    }),
    handler: (c, input) => c.config.list(input as any),
  },
  {
    name: 'get_config',
    description: 'Get details and value for a specific configuration key.',
    input: z.object({ key: z.string() }),
    handler: (c, input) => c.config.get((input as { key: string }).key),
  },
  {
    name: 'set_config',
    description: 'Set or update a configuration key in the central dual-vault config store.',
    input: z.object({
      key: z.string(),
      value: z.unknown(),
      isSecret: z.boolean().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    handler: (c, input) => {
      const { key, ...body } = input as { key: string; value: unknown; isSecret?: boolean; description?: string; tags?: string[] };
      return c.config.set(key, body);
    },
  },
  {
    name: 'delete_config',
    description: 'Delete a custom configuration key from the configuration center.',
    input: z.object({ key: z.string() }),
    handler: (c, input) => c.config.delete((input as { key: string }).key),
  },
  // ── Navigation & Menus ─────────────────────────────────────────────────
  {
    name: 'list_menus',
    description: 'List dynamic navigation menu items contributed by official and community plugins.',
    input: z.object({ slot: z.string().optional() }),
    handler: (c, input) => c.menus.list(input as any),
  },
  // ── Demo & Service Configuration ───────────────────────────────────────
  {
    name: 'seed_demo',
    description: 'Seed the full demo stack including PostgreSQL database, Next.js Docker app with host port publishing, and Next.js PM2 service.',
    input: z.object({}),
    handler: (c) => c.demo.seed(),
  },
  {
    name: 'update_service',
    description: 'Update a service configuration, including port, published host port (publishedPort), and branch.',
    input: z.object({
      serviceId: z.number().int().positive(),
      name: z.string().optional(),
      port: z.number().int().min(1).max(65535).optional(),
      publishedPort: z.number().int().min(1).max(65535).nullable().optional(),
      branch: z.string().optional(),
    }),
    handler: (c, input) => {
      const { serviceId, ...patch } = input as { serviceId: number; name?: string; port?: number; publishedPort?: number | null; branch?: string };
      return c.services.update(serviceId, patch);
    },
  },
  // ── Workspaces & Teams ─────────────────────────────────────────────────
  {
    name: 'list_workspaces',
    description: 'List all accessible workspaces and organizations with roles and member counts.',
    input: z.object({}),
    handler: (c) => c.workspaces.list(),
  },
  {
    name: 'get_workspace',
    description: 'Get details of a specific workspace including full member list and roles.',
    input: z.object({ id: z.number().int().positive() }),
    handler: (c, input) => c.workspaces.get((input as { id: number }).id),
  },
  // ── Containers & Files ─────────────────────────────────────────────────
  {
    name: 'list_container_files',
    description: 'Explore files and directories inside a live deployed service container.',
    input: z.object({
      container: z.string().min(1),
      path: z.string().optional(),
    }),
    handler: (c, input) => {
      const { container, path } = input as { container: string; path?: string };
      return c.containers.listFiles(container, path);
    },
  },
  {
    name: 'inspect_container',
    description: 'Get deep runtime inspection data for a container including state, mounts, network IP, resource limits, and Traefik tags.',
    input: z.object({ container: z.string().min(1) }),
    handler: (c, input) => c.containers.inspect((input as { container: string }).container),
  },
  {
    name: 'get_container_compose',
    description: 'Generate and retrieve the live Docker Compose YAML manifest for a running container or service.',
    input: z.object({ container: z.string().min(1) }),
    handler: (c, input) => c.containers.compose((input as { container: string }).container),
  },
  // ── Observability & Log Drains ─────────────────────────────────────────
  {
    name: 'list_log_drains',
    description: 'List structured log drain endpoints (Loki, Datadog, Vector, Syslog, HTTP) forwarding runtime logs.',
    input: z.object({ serviceId: z.number().int().positive().optional() }),
    handler: (c, input) => c.logDrains.list(input as { serviceId?: number }),
  },
  // ── Housekeeping & Maintenance ─────────────────────────────────────────
  {
    name: 'system_autoprune',
    description: 'Trigger immediate housekeeping prune to purge dangling Docker images, stopped containers, and expired build artifacts.',
    input: z.object({}),
    handler: (c) => c.housekeeping.runPrune(),
  },
];
