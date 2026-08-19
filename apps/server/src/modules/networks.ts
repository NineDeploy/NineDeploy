import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { run } from '../lib/exec.js';
import { agentOp } from '../lib/agentClient.js';
import { listUserNetworks, networkMembers } from '../lib/inventory.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';

const noop = (): void => undefined;

const RE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Run an agent op, converting agent failures into a 400. */
async function agentOr400<T>(p: Promise<T>): Promise<T> {
  return p.catch((err) => {
    throw badRequest(err instanceof Error ? err.message : 'agent operation failed');
  });
}

const createBody = z.object({
  name: z.string().regex(RE_NAME).min(1).max(100),
  driver: z.enum(['bridge', 'overlay']).default('bridge'),
  /** Remote server (null/omitted = this host). */
  serverId: z.number().int().positive().nullish(),
});

const attachBody = z.object({
  network: z.string().regex(RE_NAME),
  container: z.string().regex(RE_NAME),
  serverId: z.number().int().positive().nullish(),
});

/** Docker network management UI backend. Mounted under /networks. */
export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // List user-defined networks with their members.
  app.get('/', async (req) => {
    const serverId = Number((req.query as { serverId?: string }).serverId);
    if (Number.isInteger(serverId) && serverId > 0) {
      // Remote hosts: the agent's typed op table currently has no network-list
      // op — report empty rather than pretending. Create/attach/detach work.
      return { networks: [], remote: serverId };
    }
    const networks = await listUserNetworks().catch(() => []);
    const withMembers = await Promise.all(
      networks.map(async (n) => ({
        ...n,
        members: await networkMembers(n.name).catch(() => []),
      })),
    );
    return { networks: withMembers, remote: null };
  });

  app.post('/', { preHandler: app.requireAdmin }, async (req) => {
    const input = createBody.parse(req.body);
    if (input.serverId != null) {
      await agentOr400(agentOp(app.db, input.serverId, 'docker.networkCreate', {
        name: input.name,
        driver: input.driver,
      }, noop));
    } else {
      await run('docker', ['network', 'create', '--driver', input.driver, input.name], {}, noop);
    }
    void audit(app.db, req.user!.id, 'network.create', input.name, { driver: input.driver });
    return { ok: true, name: input.name };
  });

  app.delete('/:name', { preHandler: app.requireAdmin }, async (req) => {
    const name = String((req.params as { name: string }).name);
    if (!RE_NAME.test(name)) throw badRequest('Invalid network name');
    const serverId = Number((req.query as { serverId?: string }).serverId);
    if (Number.isInteger(serverId) && serverId > 0) {
      await agentOr400(agentOp(app.db, serverId, 'docker.networkRm', { name }, noop));
    } else {
      await run('docker', ['network', 'rm', name], {}, noop).catch(() => undefined);
    }
    void audit(app.db, req.user!.id, 'network.delete', name);
    return { ok: true };
  });

  // Attach / detach a container to/from a network.
  app.post('/attach', { preHandler: app.requireAdmin }, async (req) => {
    const input = attachBody.parse(req.body);
    if (input.serverId != null) {
      await agentOr400(agentOp(app.db, input.serverId, 'docker.networkConnect', {
        network: input.network,
        container: input.container,
      }, noop));
    } else {
      await run('docker', ['network', 'connect', input.network, input.container], {}, noop);
    }
    void audit(app.db, req.user!.id, 'network.attach', `${input.container} → ${input.network}`);
    return { ok: true };
  });

  app.post('/detach', { preHandler: app.requireAdmin }, async (req) => {
    const input = attachBody.parse(req.body);
    if (input.serverId != null) {
      await agentOr400(agentOp(app.db, input.serverId, 'docker.networkDisconnect', {
        network: input.network,
        container: input.container,
      }, noop));
    } else {
      await run('docker', ['network', 'disconnect', input.network, input.container], {}, noop);
    }
    void audit(app.db, req.user!.id, 'network.detach', `${input.container} ↮ ${input.network}`);
    return { ok: true };
  });

  // Member listing for one network (used by the attach/detach UI).
  app.get('/:name/members', async (req) => {
    const name = String((req.params as { name: string }).name);
    if (!RE_NAME.test(name)) throw badRequest('Invalid network name');
    try {
      return { members: await networkMembers(name) };
    } catch {
      return { members: [] };
    }
  });
};

/** Exposed for tests: validate a docker-CLI name operand. */
export const isValidNetworkName = (name: string): boolean => RE_NAME.test(name);
