import { deployments, envVars, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { TEMPLATES, type Template } from '../templates/registry.js';
import { encrypt } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

const summary = (t: Template) => ({ id: t.id, name: t.name, tagline: t.tagline, category: t.category, emoji: t.emoji, featured: t.featured });

/** Template hub: list, detail, one-click deploy. Mounted under /templates. */
export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => TEMPLATES.map(summary));

  app.get('/:id', async (req) => {
    const t = TEMPLATES.find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    return t;
  });

  app.post('/:id/deploy', async (req) => {
    const t = TEMPLATES.find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');

    // Unique slug to allow deploying the same template multiple times.
    const slug = `${slugify(t.name)}-${Date.now().toString(36).slice(-4)}`;
    const [svc] = await app.db
      .insert(services)
      .values({
        name: t.name,
        slug,
        type: 'docker',
        image: t.image,
        port: t.port,
        volumeMount: t.volumeMount ?? null,
        repoUrl: null,
      })
      .returning();

    for (const e of t.env ?? []) {
      await app.db.insert(envVars).values({ serviceId: svc!.id, key: e.key, valueEncrypted: encrypt(e.value), isSecret: e.secret ?? false });
    }

    const [dep] = await app.db
      .insert(deployments)
      .values({ serviceId: svc!.id, status: 'queued', trigger: 'user', message: `Deploy from template: ${t.name}` })
      .returning();
    return { serviceId: svc!.id, deploymentId: dep!.id };
  });
};
