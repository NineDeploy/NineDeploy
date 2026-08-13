import { eq } from 'drizzle-orm';
import { audit } from "../lib/audit.js";
import { sources, type Source } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createSource, sourcePatch } from '@ninedeploy/schemas';
import { encrypt } from '../lib/crypto.js';
import { notFound, parseId } from '../lib/errors.js';

function serialize(s: Source) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    hasToken: !!s.tokenEncrypted,
    hasDeployKey: !!s.deployKeyEncrypted,
    defaultBranch: s.defaultBranch,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Source (private-repo credential) management. Mounted under /sources. Admin-only. */
export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  // System-wide credentials — admin-only under the agreed RBAC model.
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => {
    const rows = await app.db.query.sources.findMany({ orderBy: (s, { desc }) => [desc(s.id)] });
    return rows.map(serialize);
  });

  app.post('/', async (req) => {
    const input = createSource.parse(req.body);
    const [created] = await app.db
      .insert(sources)
      .values({
        name: input.name,
        type: input.type,
        tokenEncrypted: input.token ? encrypt(input.token) : null,
        deployKeyEncrypted: input.deployKey ? encrypt(input.deployKey) : null,
        defaultBranch: input.defaultBranch ?? 'main',
      })
      .returning();
    void audit(app.db, req.user!.id, 'source.create', input.name);
    return serialize(created!);
  });

  app.patch('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = sourcePatch.parse(req.body ?? {});
    const patch: Partial<Source> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.defaultBranch !== undefined) patch.defaultBranch = input.defaultBranch;
    if (input.token !== undefined) patch.tokenEncrypted = input.token ? encrypt(input.token) : null;
    if (input.deployKey !== undefined) patch.deployKeyEncrypted = input.deployKey ? encrypt(input.deployKey) : null;
    const [updated] = await app.db.update(sources).set(patch).where(eq(sources.id, id)).returning();
    if (!updated) throw notFound('Source not found');
    return serialize(updated);
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    await app.db.delete(sources).where(eq(sources.id, id));
    void audit(app.db, req.user!.id, 'source.delete', String(id));
    return { ok: true };
  });
};
