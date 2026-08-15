import { deployments, envVars, services } from '@ninedeploy/db';
import { audit } from "../lib/audit.js";
import type { FastifyPluginAsync } from 'fastify';
import { getTemplates, type Template } from '../templates/registry.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

const summary = (t: Template) => ({ id: t.id, name: t.name, tagline: t.tagline, category: t.category, emoji: t.emoji, featured: t.featured });

/** Template hub: list, detail, one-click deploy. Mounted under /templates. */
export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => (await getTemplates(app.db)).map(summary));

  app.get('/:id', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    return t;
  });

  app.post('/:id/deploy', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
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
        cmd: t.cmd ?? null,
        dockerSocket: t.dockerSocket ?? false,
      })
      .returning();

    // Secret env values are ALWAYS freshly generated — registry defaults like
    // "changeme" must never reach a running container. The generated values
    // are returned once so the caller (CLI/UI) can show them to the user.
    const generatedSecrets: Array<{ key: string; value: string }> = [];
    for (const e of t.env ?? []) {
      const value = e.secret ? randomToken(18) : e.value;
      if (e.secret) generatedSecrets.push({ key: e.key, value });
      await app.db.insert(envVars).values({ serviceId: svc!.id, key: e.key, valueEncrypted: encrypt(value), isSecret: e.secret ?? false });
    }

    const [dep] = await app.db
      .insert(deployments)
      .values({ serviceId: svc!.id, status: 'queued', trigger: 'user', message: `Deploy from template: ${t.name}` })
      .returning();
    void audit(app.db, req.user!.id, 'template.deploy', t.name);
    return { serviceId: svc!.id, deploymentId: dep!.id, generatedSecrets };
  });
};
