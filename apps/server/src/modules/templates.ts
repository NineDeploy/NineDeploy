import { databaseAttachments, databases, deployments, envVars, services } from '@ninedeploy/db';
import { eq } from 'drizzle-orm';
import { audit } from '../lib/audit.js';
import type { FastifyPluginAsync } from 'fastify';
import { getTemplates, type Template } from '../templates/registry.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';
import { defaultPort, ENGINES, startDatabase } from '../engine/database.js';

const summary = (t: Template) => ({
  id: t.id,
  name: t.name,
  tagline: t.tagline,
  category: t.category,
  emoji: t.emoji,
  featured: t.featured,
  runtimeVerified: t.runtimeVerified === true,
  verifiedAt: t.verifiedAt,
});

/** Template hub: list, detail, one-click deploy. Mounted under /templates. */
export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => (await getTemplates(app.db)).map(summary));

  app.get('/:id', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    return { ...t, runtimeVerified: t.runtimeVerified === true };
  });

  app.post('/:id/deploy', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');

    // Unique slug to allow deploying the same template multiple times.
    const slug = `${slugify(t.name)}-${Date.now().toString(36).slice(-4)}`;
    const [svc] = await app.db
      .insert(services)
      .values({
        ownerUserId: req.user!.id,
        name: t.name,
        slug,
        type: 'docker',
        image: t.image,
        port: t.port,
        volumeMount: t.volumeMount ?? null,
        repoUrl: null,
        cmd: t.cmd ?? null,
        dockerSocket: t.dockerSocket ?? false,
        templateDatabaseEnv: t.databaseEnv ?? null,
      })
      .returning();

    // Secret env values are ALWAYS freshly generated — registry defaults like
    // "changeme" must never reach a running container. The generated values
    // are returned once so the caller (CLI/UI) can show them to the user.
    const generatedSecrets: Array<{ key: string; value: string }> = [];
    for (const e of t.env ?? []) {
      const value = e.secret ? randomToken(18) : e.value;
      if (e.secret) generatedSecrets.push({ key: e.key, value });
      await app.db.insert(envVars).values({
        serviceId: svc!.id,
        scope: 'service',
        scopeKey: svc!.id,
        key: e.key,
        valueEncrypted: encrypt(value),
        isSecret: e.secret ?? false,
      });
    }

    // CLI/SDK one-click deploys do not run the Web wizard. Provision the
    // template's database here as well, and persist the attachment before the
    // deployment is queued so the pipeline can inject databaseEnv fields.
    let databaseId: number | null = null;
    if (t.dbEngine) {
      const cfg = ENGINES[t.dbEngine];
      if (!cfg || !t.databaseEnv) throw badRequest(`Template '${t.id}' has an invalid database contract`);
      const dbSlug = `${slug}-db`;
      const password = randomToken(18);
      const [database] = await app.db
        .insert(databases)
        .values({
          ownerUserId: req.user!.id,
          name: `${t.name} DB`,
          slug: dbSlug,
          engine: t.dbEngine,
          status: 'creating',
          containerName: `nd-db-${dbSlug}`,
          volumeName: `nd-db-${dbSlug}-data`,
          username: cfg.username() ?? null,
          passwordEncrypted: encrypt(password),
          dbName: cfg.dbName() ?? null,
          extensions: [],
          webGuiEnabled: false,
        })
        .returning();
      if (!database) throw badRequest('Could not create template database');
      databaseId = database.id;
      try {
        await startDatabase(database, (line) => app.log.info({ component: 'template-database' }, line));
        await app.db
          .update(databases)
          .set({ status: 'running', internalHost: database.containerName, internalPort: defaultPort(database.engine) })
          .where(eq(databases.id, database.id));
        await app.db.insert(databaseAttachments).values({
          serviceId: svc!.id,
          databaseId: database.id,
          envAlias: t.dbEngine === 'redis' || t.dbEngine === 'valkey' ? 'REDIS_URL' : 'DATABASE_URL',
        });
      } catch (error) {
        await app.db.update(databases).set({ status: 'error' }).where(eq(databases.id, database.id));
        throw badRequest(`Failed to start template database: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const [dep] = await app.db
      .insert(deployments)
      .values({ serviceId: svc!.id, status: 'queued', trigger: 'user', message: `Deploy from template: ${t.name}` })
      .returning();
    void audit(app.db, req.user!.id, 'template.deploy', t.name);
    return { serviceId: svc!.id, deploymentId: dep!.id, databaseId, generatedSecrets };
  });
};
