import { eq } from 'drizzle-orm';
import { audit } from "../lib/audit.js";
import { sources, type Source } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createSource, sourcePatch } from '@ninedeploy/schemas';
import { decrypt, encrypt } from '../lib/crypto.js';
import { notFound, parseId } from '../lib/errors.js';

function serialize(s: Source) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    hasToken: !!s.tokenEncrypted,
    hasDeployKey: !!s.deployKeyEncrypted,
    registryUsername: s.registryUsername ?? null,
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
        registryUsername: input.registryUsername ?? null,
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
    if (input.registryUsername !== undefined) patch.registryUsername = input.registryUsername || null;
    const [updated] = await app.db.update(sources).set(patch).where(eq(sources.id, id)).returning();
    if (!updated) throw notFound('Source not found');
    return serialize(updated);
  });

  app.get('/:id/repos', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const src = await app.db.query.sources.findFirst({ where: eq(sources.id, id) });
    if (!src) throw notFound('Source not found');
    if (!src.tokenEncrypted) return [];

    const token = decrypt(src.tokenEncrypted);
    if (src.type === 'github') {
      try {
        const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'NineDeploy',
          },
        });
        if (!res.ok) return [];
        const data = (await res.json()) as Array<{
          name: string;
          full_name: string;
          clone_url: string;
          default_branch: string;
          private: boolean;
        }>;
        return data.map((r) => ({
          name: r.name,
          fullName: r.full_name,
          url: r.clone_url,
          defaultBranch: r.default_branch || 'main',
          isPrivate: r.private,
        }));
      } catch {
        return [];
      }
    }

    if (src.type === 'gitlab') {
      try {
        const res = await fetch('https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=updated_at', {
          headers: { 'PRIVATE-TOKEN': token },
        });
        if (!res.ok) return [];
        const data = (await res.json()) as Array<{
          name: string;
          path_with_namespace: string;
          http_url_to_repo: string;
          default_branch: string;
          visibility: string;
        }>;
        return data.map((r) => ({
          name: r.name,
          fullName: r.path_with_namespace,
          url: r.http_url_to_repo,
          defaultBranch: r.default_branch || 'main',
          isPrivate: r.visibility !== 'public',
        }));
      } catch {
        return [];
      }
    }

    return [];
  });

  app.get('/:id/branches', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const src = await app.db.query.sources.findFirst({ where: eq(sources.id, id) });
    if (!src || !src.tokenEncrypted) return ['main', 'master'];
    const repo = (req.query as { repo?: string }).repo;
    if (!repo) return ['main', 'master'];

    const token = decrypt(src.tokenEncrypted);
    if (src.type === 'github') {
      try {
        // repo can be full_name "owner/repo" or clone_url
        const cleanRepo = repo.replace('https://github.com/', '').replace(/\.git$/, '');
        const res = await fetch(`https://api.github.com/repos/${cleanRepo}/branches?per_page=100`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'NineDeploy',
          },
        });
        if (!res.ok) return ['main', 'master'];
        const data = (await res.json()) as Array<{ name: string }>;
        return data.map((b) => b.name);
      } catch {
        return ['main', 'master'];
      }
    }
    return ['main', 'master'];
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    await app.db.delete(sources).where(eq(sources.id, id));
    void audit(app.db, req.user!.id, 'source.delete', String(id));
    return { ok: true };
  });
};
