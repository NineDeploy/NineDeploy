import { eq } from 'drizzle-orm';
import { servers, type ServerRow } from '@ninedeploy/db';
import { serverCreate } from '@ninedeploy/schemas';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../lib/audit.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, notFound, parseId } from '../lib/errors.js';
import { agentPing, generateAgentToken } from '../lib/agentClient.js';

function serialize(s: ServerRow) {
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    status: s.status,
    lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Remote server registry (admin only). Registering generates a shared agent
 * token returned exactly once — the remote host runs the agent with
 * NINEDEPLOY_AGENT=1 + its sha256 hash.
 */
export const serverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => {
    const rows = await app.db.query.servers.findMany();
    return rows.map(serialize);
  });

  app.post('/', async (req) => {
    const { name, host, port } = serverCreate.parse(req.body ?? {});
    const token = generateAgentToken();
    const [row] = await app.db
      .insert(servers)
      .values({ name, host, port, tokenEncrypted: encrypt(token), status: 'offline' })
      .returning();
    if (!row) throw badRequest('Could not register server');
    void audit(app.db, req.user!.id, 'server.register', name);
    // The raw token is returned exactly once; the agent needs its sha256.
    const { createHash } = await import('node:crypto');
    return {
      ...serialize(row),
      token,
      tokenSha256: createHash('sha256').update(token).digest('hex'),
      agentCommand: `NINEDEPLOY_AGENT=1 NINEDEPLOY_AGENT_TOKEN=${'{sha256}'} ninedeploy-server`,
    };
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    await app.db.delete(servers).where(eq(servers.id, id));
    void audit(app.db, req.user!.id, 'server.delete', `#${id}`);
    return { ok: true };
  });

  // Connectivity + auth probe; on success the server is marked online.
  app.post('/:id/test', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const row = await app.db.query.servers.findFirst({ where: eq(servers.id, id) });
    if (!row) throw notFound('Server not found');
    try {
      await agentPing(row.host, row.port, decrypt(row.tokenEncrypted));
    } catch (err) {
      await app.db.update(servers).set({ status: 'error' }).where(eq(servers.id, id));
      throw badRequest(`Agent unreachable: ${err instanceof Error ? err.message : err}`);
    }
    await app.db.update(servers).set({ status: 'online', lastSeenAt: new Date() }).where(eq(servers.id, id));
    void audit(app.db, req.user!.id, 'server.test', row.name);
    return { ok: true, status: 'online' };
  });
};
