import {
  buildConfigs,
  deployments,
  envVars,
  services,
  type Service,
} from '@ninedeploy/db';
import { deployTemplate, type DeployTemplate } from '@ninedeploy/schemas';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '../lib/audit.js';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { getTemplates, type Template } from '../templates/registry.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertMayUseHostPrivilege } from '../lib/hostPrivilege.js';
import { isAdmin, type AuthedUser } from '../lib/resourceAccess.js';
import { assertMayPublishPort } from '../lib/hostPort.js';
import { slugify } from '../lib/slug.js';

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

async function prepareTemplateService(
  app: FastifyInstance,
  template: Template,
  input: DeployTemplate,
  user: AuthedUser,
): Promise<{ service: Service; generatedSecrets: Array<{ key: string; value: string }>; stages: ProvisionStage[] }> {
  const ownerUserId = user.id;
  const projectId = input.projectId ?? null;
  const name = input.name ?? template.name;
  const requestedSlug = input.name ? slugify(name) : `${slugify(template.name)}-${Date.now().toString(36).slice(-4)}`;
  const stages: ProvisionStage[] = [];

  let slug = requestedSlug;
  let service = await app.db.query.services.findFirst({ where: eq(services.slug, slug) });
  // L-12: `slug_taken` used to answer for services the caller cannot see,
  // turning template deploy into a probe for other tenants' service names.
  // A collision with someone else's service is now resolved by picking a free
  // slug instead of reporting theirs — the caller gets a working service and
  // learns nothing. A collision with a service they CAN see keeps the explicit
  // error, because that one is actionable.
  if (service && service.ownerUserId !== ownerUserId && !isAdmin(user)) {
    let attempt = 0;
    do {
      slug = `${requestedSlug}-${randomToken(3).slice(0, 4)}`;
      service = await app.db.query.services.findFirst({ where: eq(services.slug, slug) });
    } while (service && ++attempt < 5);
    if (service) throw badRequest('Could not allocate a free service slug — try a different name');
  }
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
      templateId: template.id,
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
      templateId: template.id,
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

  const queue = async (req: FastifyRequest) => {
    const t = (await getTemplates(app.db)).find((x) => x.id === (req.params as { id: string }).id);
    if (!t) throw notFound('Template not found');
    const input = deployTemplate.parse(req.body ?? {});
    // Templates that mount the Docker socket (Portainer, Dockge, Dozzle,
    // Homepage) hand the container control of every other container on the
    // host — admin-only, like the exec terminal.
    assertMayUseHostPrivilege(req.user!, { type: 'docker', dockerSocket: t.dockerSocket ?? false });
    assertMayPublishPort(req.user!, input.publishedPort);
    const prepared = await prepareTemplateService(app, t, input, req.user!);
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
        status: 'queued',
        trigger: 'user',
        message: `Deploy from template: ${t.name}`,
      }).returning();
    }
    if (!deployment) throw badRequest('Could not queue template deployment');
    prepared.stages.push({
      id: 'database',
      status: t.dbEngine ? 'success' : 'skipped',
      message: t.dbEngine ? `${t.dbEngine} dependency queued for worker reconciliation` : 'Template has no managed database dependency',
    });
    prepared.stages.push({
      id: 'attachment',
      status: t.dbEngine ? 'success' : 'skipped',
      message: t.dbEngine ? 'Database attachment queued for worker reconciliation' : 'No database attachment required',
    });
    prepared.stages.push({ id: 'deployment', status: 'success', message: 'Durable application deployment queued' });
    void audit(app.db, req.user!.id, 'template.deploy', `${t.name} → ${prepared.service.name}`);
    return {
      serviceId: prepared.service.id,
      serviceName: prepared.service.name,
      serviceSlug: prepared.service.slug,
      deploymentId: deployment.id,
      databaseId: null,
      generatedSecrets: prepared.generatedSecrets,
      stages: prepared.stages,
      alreadyInProgress: deployment.status !== 'queued',
    };
  };

  // Both endpoints are aliases of the same durable operation. There is no
  // browser-owned second phase: once this returns, the worker owns the job.
  app.post('/:id/prepare', queue);
  app.post('/:id/deploy', queue);
};
