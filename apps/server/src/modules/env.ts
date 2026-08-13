import { and, eq } from 'drizzle-orm';
import { envVars } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { upsertEnvVar } from '@ninedeploy/schemas';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';

const num = (v: string) => Number(v);

function serialize(e: typeof envVars.$inferSelect) {
  return {
    id: e.id,
    key: e.key,
    value: e.isSecret ? '' : decrypt(e.valueEncrypted),
    isSecret: e.isSecret,
  };
}

/** Environment variable management for a service. Mounted under /services. */
export const envRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/env', async (req) => {
    const id = num((req.params as { id: string }).id);
    const rows = await app.db.query.envVars.findMany({ where: eq(envVars.serviceId, id), orderBy: (e, { asc }) => [asc(e.key)] });
    return rows.map(serialize);
  });

  app.post('/:id/env', async (req) => {
    const id = num((req.params as { id: string }).id);
    const input = upsertEnvVar.parse(req.body);
    const [created] = await app.db
      .insert(envVars)
      .values({ serviceId: id, key: input.key, valueEncrypted: encrypt(input.value), isSecret: input.isSecret ?? false })
      .returning()
      .catch(() => [] as typeof envVars.$inferSelect[]);
    if (!created) throw badRequest('Env var with that key already exists');
    return serialize(created);
  });

  app.patch('/:id/env/:varId', async (req) => {
    const id = num((req.params as { id: string }).id);
    const varId = num((req.params as { varId: string }).varId);
    const input = upsertEnvVar.parse(req.body);
    const [updated] = await app.db
      .update(envVars)
      .set({ valueEncrypted: encrypt(input.value), isSecret: input.isSecret ?? false })
      .where(and(eq(envVars.id, varId), eq(envVars.serviceId, id)))
      .returning();
    if (!updated) throw notFound('Env var not found');
    return serialize(updated);
  });

  app.delete('/:id/env/:varId', async (req) => {
    const id = num((req.params as { id: string }).id);
    const varId = num((req.params as { varId: string }).varId);
    await app.db.delete(envVars).where(and(eq(envVars.id, varId), eq(envVars.serviceId, id)));
    return { ok: true };
  });
};
