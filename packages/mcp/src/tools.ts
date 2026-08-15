import { z } from 'zod';
import type { NineDeployClient } from '@ninedeploy/sdk';

/**
 * The MCP tool surface: read-only inspection plus three guarded actions
 * (deploy, restart, rollback). Every tool maps 1:1 onto the typed SDK, so
 * the MCP wire can never express anything the HTTP API could not.
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
    handler: (c, input) => c.activity.list((input as { entity?: string }).entity),
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
    name: 'rollback_deploy',
    description: 'Roll a service back to a previous deployment (by deployment id).',
    input: z.object({ serviceId: z.number().int().positive(), deploymentId: z.number().int().positive() }),
    handler: (c, input) => {
      const { serviceId, deploymentId } = input as { serviceId: number; deploymentId: number };
      return c.deploys.rollback(serviceId, deploymentId);
    },
  },
];
