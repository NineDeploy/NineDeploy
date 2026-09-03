import { badRequest } from './errors.js';

/**
 * Remote-server deployments are not implemented.
 *
 * The agent protocol itself is real and in use — `modules/networks.ts` drives
 * `docker.network*` on remote hosts through `agentOp`, and `src/agent.ts`
 * exposes typed docker/git operations. What does NOT exist is any builder that
 * uses it: `engine/pipeline.ts` binds `ctx.agentCall` for a service with
 * `serverId` set, but docker, pm2 and compose all shell out locally through
 * `lib/exec.ts`. A deploy assigned to a remote node therefore lands on the
 * PANEL host, while the panel reports it as running on the node.
 *
 * Refusing is the honest behaviour until a builder actually routes through the
 * agent: a failed deployment with this reason is recoverable, a container on
 * the wrong host is not.
 */
export const REMOTE_DEPLOY_UNSUPPORTED =
  'Deployments to a remote server are not implemented yet — the build would run on the panel host instead of the assigned node. Clear the target server to deploy here.';

/** Throw a 400 for a service pinned to a remote node (queue-time feedback). */
export function assertLocalDeployTarget(service: { serverId?: number | null }): void {
  if (service.serverId != null) throw badRequest(REMOTE_DEPLOY_UNSUPPORTED, 'remote_deploy_unsupported');
}
