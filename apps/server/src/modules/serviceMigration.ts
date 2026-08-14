import { eq } from 'drizzle-orm';
import {
  buildConfigs, databaseAttachments, databases, domains, envVars, services, webhooks,
} from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

const num = (v: string) => Number(v);

interface ServiceBundle {
  version: string;
  exportedAt: string;
  service: {
    name: string;
    type: string;
    repoUrl: string | null;
    branch: string;
    image: string | null;
    port: number | null;
    volumeMount: string | null;
    healthPath: string;
    cpuShares: number;
    memLimitMb: number;
  };
  buildConfig: {
    buildPack: string;
    baseDir: string;
    installCmd: string | null;
    buildCmd: string | null;
    startCmd: string | null;
    dockerfilePath: string | null;
  } | null;
  envVars: Array<{ key: string; value: string; isSecret: boolean }>;
  domains: Array<{ hostname: string; path: string; ssl: boolean }>;
  webhooks: Array<{ branch: string; events: string[]; secret: string }>;
  attachments: Array<{ envAlias: string; databaseName: string; databaseEngine: string }>;
}

/**
 * Per-service export/import. Mounted under /services. Admin-only: the exported
 * bundle contains every secret (env vars, webhook secrets) in PLAINTEXT.
 */
export const serviceMigrationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  // ── Export: download a service as a JSON bundle ──────────────────────
  app.get('/:id/export', async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');

    const [bc, envs, doms, hooks, atts] = await Promise.all([
      app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, id) }),
      app.db.query.envVars.findMany({ where: eq(envVars.serviceId, id) }),
      app.db.query.domains.findMany({ where: eq(domains.serviceId, id) }),
      app.db.query.webhooks.findMany({ where: eq(webhooks.serviceId, id) }),
      app.db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, id) }),
    ]);

    // Resolve attachment database names
    const attachmentInfos = [];
    for (const a of atts) {
      const attachedDb = await app.db.query.databases.findFirst({ where: eq(databases.id, a.databaseId) });
      if (attachedDb) attachmentInfos.push({ envAlias: a.envAlias, databaseName: attachedDb.name, databaseEngine: attachedDb.engine });
    }

    const bundle: ServiceBundle = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      service: {
        name: svc.name,
        type: svc.type,
        repoUrl: svc.repoUrl,
        branch: svc.branch,
        image: svc.image,
        port: svc.port,
        volumeMount: svc.volumeMount,
        healthPath: svc.healthPath,
        cpuShares: svc.cpuShares,
        memLimitMb: svc.memLimitMb,
      },
      buildConfig: bc ? {
        buildPack: bc.buildPack,
        baseDir: bc.baseDir,
        installCmd: bc.installCmd,
        buildCmd: bc.buildCmd,
        startCmd: bc.startCmd,
        dockerfilePath: bc.dockerfilePath,
      } : null,
      envVars: envs.map((e) => ({ key: e.key, value: decrypt(e.valueEncrypted), isSecret: e.isSecret })),
      domains: doms.map((d) => ({ hostname: d.hostname, path: d.path, ssl: d.ssl })),
      webhooks: hooks.map((w) => ({ branch: w.branch, events: w.events, secret: decrypt(w.secretEncrypted) })),
      attachments: attachmentInfos,
    };

    reply.type('application/json').header('content-disposition', `attachment; filename="${svc.slug}-export.json"`);
    return bundle;
  });

  // ── Import: recreate a service from a JSON bundle ────────────────────
  app.post('/import', async (req) => {
    const bundle = req.body as ServiceBundle;
    if (!bundle?.service?.name) throw badRequest('Invalid bundle: missing service data');

    // Unique slug to avoid conflicts
    const slug = `${slugify(bundle.service.name)}-${Date.now().toString(36).slice(-4)}`;

    const [svc] = await app.db.insert(services).values({
      name: bundle.service.name,
      slug,
      type: bundle.service.type as 'docker' | 'pm2',
      repoUrl: bundle.service.repoUrl,
      branch: bundle.service.branch,
      image: bundle.service.image,
      port: bundle.service.port,
      volumeMount: bundle.service.volumeMount,
      healthPath: bundle.service.healthPath || '/',
      cpuShares: bundle.service.cpuShares || 0,
      memLimitMb: bundle.service.memLimitMb || 0,
      status: 'idle',
    }).returning();
    if (!svc) throw badRequest('Could not create service');

    // Build config
    if (bundle.buildConfig) {
      const bc = bundle.buildConfig;
      await app.db.insert(buildConfigs).values({
        serviceId: svc.id,
        buildPack: bc.buildPack as 'auto' | 'nixpacks' | 'dockerfile',
        baseDir: bc.baseDir || '/',
        installCmd: bc.installCmd,
        buildCmd: bc.buildCmd,
        startCmd: bc.startCmd,
        dockerfilePath: bc.dockerfilePath,
      });
    }

    // Env vars (re-encrypt with this instance's master key)
    for (const e of bundle.envVars) {
      await app.db.insert(envVars).values({
        serviceId: svc.id,
        key: e.key,
        valueEncrypted: encrypt(e.value),
        isSecret: e.isSecret,
      });
    }

    // Domains (only custom ones, skip wildcard auto-domains)
    for (const d of bundle.domains) {
      if (d.hostname.includes('.')) {
        await app.db.insert(domains).values({
          serviceId: svc.id,
          hostname: d.hostname,
          path: d.path,
          ssl: d.ssl,
          status: 'active',
        });
      }
    }

    // Webhooks (re-encrypt secrets)
    for (const w of bundle.webhooks) {
      await app.db.insert(webhooks).values({
        serviceId: svc.id,
        branch: w.branch,
        events: w.events,
        secretEncrypted: encrypt(w.secret),
        active: true,
      });
    }

    // Attachments (best-effort: try to find matching database by name+engine)
    // Attachments (best-effort: try to find matching database by name+engine)
    for (const a of bundle.attachments) {
      const match = await app.db.query.databases.findFirst({ where: eq(databases.name, a.databaseName) });
      if (match) {
        await app.db.insert(databaseAttachments).values({
          serviceId: svc.id,
          databaseId: match.id,
          envAlias: a.envAlias,
        });
      }
    }

    return { ok: true, serviceId: svc.id, slug, message: `Service "${bundle.service.name}" imported. Deploy to activate.` };
  });
};
