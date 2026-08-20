import {
  buildConfigs,
  databaseAttachments,
  databases,
  deployments,
  envVars,
  services,
  type Database,
  type Service,
} from '@ninedeploy/db';
import { deployTemplate, type DeployTemplate } from '@ninedeploy/schemas';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '../lib/audit.js';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
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

type ProvisionStage = {
  id: 'service' | 'environment' | 'database' | 'attachment' | 'deployment';
  status: 'success' | 'skipped';
  message: string;
};

const provisioningMessage = (template: Template) => `Provisioning template dependencies: ${template.name}`;

function sameTemplateService(service: Service, template: Template, ownerUserId: number, projectId: number | null): boolean {
  return service.ownerUserId === ownerUserId
    && service.projectId === projectId
    && service.type === 'docker'
    && service.image === template.image
    && service.port === template.port
    && service.volumeMount === (template.volumeMount ?? null)
    && ['idle', 'error', 'stopped'].includes(service.status);
}

/** Upsert template defaults and user overrides without rotating existing secrets on retry. */
async function reconcileEnvironment(
  app: FastifyInstance,
  serviceId: number,
  template: Template,
  overrides: Array<{ key: string; value: string; isSecret: boolean }>,
): Promise<Array<{ key: string; value: string }>> {
  const existing = await app.db.query.envVars.findMany({ where: eq(envVars.serviceId, serviceId) });
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const requested = new Map(overrides.map((row) => [row.key, row]));
  const desired = new Map<string, { value: string; isSecret: boolean; generated: boolean }>();
  const generatedSecrets: Array<{ key: string; value: string }> = [];

  for (const entry of template.env ?? []) {
    const override = requested.get(entry.key);
    if (override) {
      desired.set(entry.key, { value: override.value, isSecret: override.isSecret, generated: false });
      requested.delete(entry.key);
    } else if (!byKey.has(entry.key)) {
      const value = entry.secret ? randomToken(18) : entry.value;
      desired.set(entry.key, { value, isSecret: entry.secret ?? false, generated: entry.secret === true });
    }
  }
  for (const [key, entry] of requested) {
    desired.set(key, { value: entry.value, isSecret: entry.isSecret, generated: false });
  }

  for (const [key, entry] of desired) {
    const values = { valueEncrypted: encrypt(entry.value), isSecret: entry.isSecret };
    const current = byKey.get(key);
    if (current) {
      await app.db.update(envVars).set(values).where(eq(envVars.id, current.id));
    } else {
      await app.db.insert(envVars).values({ serviceId, scope: 'service', scopeKey: serviceId, key, ...values });
    }
    if (entry.generated) generatedSecrets.push({ key, value: entry.value });
  }
  return generatedSecrets;
}

/** Create/reuse/start the template's dedicated managed database and attachment. */
async function reconcileDatabase(
  app: FastifyInstance,
  service: Service,
  template: Template,
  ownerUserId: number,
  projectId: number | null,
): Promise<{ database: Database; alreadyAttached: boolean } | null> {
  if (!template.dbEngine) return null;
  const cfg = ENGINES[template.dbEngine];
  if (!cfg || !template.databaseEnv) throw badRequest(`Template '${template.id}' has an invalid database contract`);

  const attachments = await app.db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, service.id) });
  let database: Database | undefined;
  let alreadyAttached = false;
  for (const attachment of attachments) {
    const candidate = await app.db.query.databases.findFirst({ where: eq(databases.id, attachment.databaseId) });
    if (candidate?.engine === template.dbEngine) {
      if (candidate.ownerUserId !== ownerUserId || candidate.projectId !== projectId) {
        throw badRequest('Attached template database belongs to another resource');
      }
      database = candidate;
      alreadyAttached = true;
      break;
    }
  }

  const dbSlug = `${service.slug}-db`;
  if (!database) {
    const retained = await app.db.query.databases.findFirst({ where: eq(databases.slug, dbSlug) });
    if (retained) {
      if (retained.ownerUserId !== ownerUserId || retained.projectId !== projectId || retained.engine !== template.dbEngine) {
        throw badRequest(`Database slug '${dbSlug}' belongs to another resource`);
      }
      database = retained;
    }
  }

  if (!database) {
    const password = randomToken(18);
    const [created] = await app.db.insert(databases).values({
      projectId,
      ownerUserId,
      name: `${service.name} DB`,
      slug: dbSlug,
      engine: template.dbEngine,
      status: 'creating',
      containerName: `nd-db-${dbSlug}`,
      volumeName: `nd-db-${dbSlug}-data`,
      username: cfg.username() ?? null,
      passwordEncrypted: encrypt(password),
      dbName: cfg.dbName() ?? null,
      extensions: [],
      webGuiEnabled: false,
    }).returning();
    if (!created) throw badRequest('Could not create template database');
    database = created;
  }

  try {
    await startDatabase(database, (line) => app.log.info({ component: 'template-database', serviceId: service.id }, line));
    await app.db.update(databases).set({
      status: 'running',
      internalHost: database.containerName,
      internalPort: defaultPort(database.engine),
    }).where(eq(databases.id, database.id));
  } catch (error) {
    await app.db.update(databases).set({ status: 'error' }).where(eq(databases.id, database.id));
    await app.db.update(services).set({ status: 'error' }).where(eq(services.id, service.id));
    throw badRequest(`Failed to start template database: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!alreadyAttached) {
    await app.db.insert(databaseAttachments).values({
      serviceId: service.id,
      databaseId: database.id,
      envAlias: template.dbEngine === 'redis' || template.dbEngine === 'valkey' ? 'REDIS_URL' : 'DATABASE_URL',
    });
  }
  return {
    database: { ...database, status: 'running', internalHost: database.containerName, internalPort: defaultPort(database.engine) },
    alreadyAttached,
  };
}

async function prepareTemplateService(
  app: FastifyInstance,
  template: Template,
  input: DeployTemplate,
  ownerUserId: number,
): Promise<{ service: Service; generatedSecrets: Array<{ key: string; value: string }>; stages: ProvisionStage[] }> {
  const projectId = input.projectId ?? null;
  const name = input.name ?? template.name;
  const slug = input.name ? slugify(name) : `${slugify(template.name)}-${Date.now().toString(36).slice(-4)}`;
  const stages: ProvisionStage[] = [];

  let service = await app.db.query.services.findFirst({ where: eq(services.slug, slug) });
  if (service) {
    if (!input.reuseExisting || !sameTemplateService(service, template, ownerUserId, projectId)) {
      throw badRequest(`A service with slug '${slug}' already exists`, 'slug_taken');
    }
    const trusted = {
      name,
      serverId: input.serverId === undefined ? service.serverId : input.serverId,
      publishedPort: input.publishedPort === undefined ? service.publishedPort : input.publishedPort,
      healthPath: input.healthPath ?? service.healthPath,
      cpuShares: input.cpuShares ?? service.cpuShares,
      memLimitMb: input.memLimitMb ?? service.memLimitMb,
      cmd: template.cmd ?? null,
      dockerSocket: template.dockerSocket ?? false,
      templateDatabaseEnv: template.databaseEnv ?? null,
    };
    await app.db.update(services).set(trusted).where(eq(services.id, service.id));
    service = { ...service, ...trusted };
    stages.push({ id: 'service', status: 'success', message: 'Existing interrupted service reconciled' });
  } else {
    const [created] = await app.db.insert(services).values({
      projectId,
      ownerUserId,
      name,
      slug,
      type: 'docker',
      image: template.image,
      port: template.port,
      publishedPort: input.publishedPort ?? null,
      healthPath: input.healthPath ?? '/',
      volumeMount: template.volumeMount ?? null,
      repoUrl: null,
      serverId: input.serverId ?? null,
      cpuShares: input.cpuShares ?? 0,
      memLimitMb: input.memLimitMb ?? 0,
      cmd: template.cmd ?? null,
      dockerSocket: template.dockerSocket ?? false,
      templateDatabaseEnv: template.databaseEnv ?? null,
    }).returning();
    if (!created) throw badRequest('Could not create template service');
    service = created;
    await app.db.insert(buildConfigs).values({ serviceId: service.id, buildPack: 'auto', baseDir: '/' });
    stages.push({ id: 'service', status: 'success', message: 'Service configuration created' });
  }

  const generatedSecrets = await reconcileEnvironment(app, service.id, template, input.env ?? []);
  stages.push({ id: 'environment', status: 'success', message: 'Environment and secrets reconciled' });
  return { service, generatedSecrets, stages };
}

/** Template hub: list, detail, canonical retry-safe one-click provisioning. */
export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => (await getTemplates(app.db)).map(summary));

  app.get('/:id', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    return { ...t, runtimeVerified: t.runtimeVerified === true };
  });

  // Fast UI hand-off: materialize the service identity first so the panel can
  // close immediately and navigate to its Deployments tab while the normal
  // deploy endpoint performs dependency provisioning in a separate request.
  app.post('/:id/prepare', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    const input = deployTemplate.parse(req.body ?? {});
    const prepared = await prepareTemplateService(app, t, input, req.user!.id);
    let deployment = await app.db.query.deployments.findFirst({
      where: and(
        eq(deployments.serviceId, prepared.service.id),
        inArray(deployments.status, ['queued', 'building', 'deploying']),
      ),
      orderBy: desc(deployments.id),
    });
    if (!deployment) {
      [deployment] = await app.db.insert(deployments).values({
        serviceId: prepared.service.id,
        status: 'building',
        trigger: 'user',
        message: provisioningMessage(t),
        startedAt: new Date(),
      }).returning();
    }
    if (!deployment) throw badRequest('Could not create template provisioning deployment');
    void audit(app.db, req.user!.id, 'template.prepare', `${t.name} → ${prepared.service.name}`);
    return {
      serviceId: prepared.service.id,
      serviceName: prepared.service.name,
      serviceSlug: prepared.service.slug,
      deploymentId: deployment.id,
      generatedSecrets: prepared.generatedSecrets,
      stages: prepared.stages,
    };
  });

  app.post('/:id/deploy', async (req) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    const input = deployTemplate.parse(req.body ?? {});
    const ownerUserId = req.user!.id;
    const projectId = input.projectId ?? null;
    const prepared = await prepareTemplateService(app, t, input, ownerUserId);
    const { service, generatedSecrets, stages } = prepared;

    const existingProgress = await app.db.query.deployments.findFirst({
      where: and(eq(deployments.serviceId, service.id), inArray(deployments.status, ['queued', 'building', 'deploying'])),
      orderBy: desc(deployments.id),
    });
    const preparedDeployment = existingProgress?.status === 'building'
      && existingProgress.message === provisioningMessage(t)
      ? existingProgress
      : undefined;

    let databaseResult: Awaited<ReturnType<typeof reconcileDatabase>>;
    try {
      databaseResult = await reconcileDatabase(app, service, t, ownerUserId, projectId);
    } catch (error) {
      if (preparedDeployment) {
        await app.db.update(deployments).set({ status: 'failed', finishedAt: new Date() }).where(eq(deployments.id, preparedDeployment.id));
      }
      throw error;
    }
    if (databaseResult) {
      stages.push({ id: 'database', status: 'success', message: `${t.dbEngine} database is running` });
      stages.push({
        id: 'attachment',
        status: 'success',
        message: databaseResult.alreadyAttached ? 'Existing database attachment verified' : 'Database attached to service',
      });
    } else {
      stages.push({ id: 'database', status: 'skipped', message: 'Template has no managed database dependency' });
      stages.push({ id: 'attachment', status: 'skipped', message: 'No database attachment required' });
    }

    let deploymentId: number;
    let alreadyInProgress = false;
    if (preparedDeployment) {
      deploymentId = preparedDeployment.id;
      await app.db.update(deployments).set({
        status: 'queued',
        startedAt: null,
        message: `Deploy from template: ${t.name}`,
      }).where(eq(deployments.id, preparedDeployment.id));
      stages.push({ id: 'deployment', status: 'success', message: 'Application deployment queued' });
    } else if (existingProgress) {
      deploymentId = existingProgress.id;
      alreadyInProgress = true;
      stages.push({ id: 'deployment', status: 'success', message: 'Existing deployment remains in progress' });
    } else {
      const [deployment] = await app.db.insert(deployments).values({
        serviceId: service.id,
        status: 'queued',
        trigger: 'user',
        message: `Deploy from template: ${t.name}`,
      }).returning();
      if (!deployment) throw badRequest('Could not queue template deployment');
      deploymentId = deployment.id;
      stages.push({ id: 'deployment', status: 'success', message: 'Application deployment queued' });
    }

    void audit(app.db, ownerUserId, 'template.deploy', `${t.name} → ${service.name}`);
    return {
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
      deploymentId,
      databaseId: databaseResult?.database.id ?? null,
      generatedSecrets,
      stages,
      alreadyInProgress,
    };
  });
};
