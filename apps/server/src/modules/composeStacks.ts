import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildConfigs, services, type Service } from '@ninedeploy/db';
import { eq } from 'drizzle-orm';
import { badRequest } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { slugify } from '../lib/slug.js';
import { config } from '../config.js';
import { getAcmeEmail } from '../engine/proxy.js';
import { preflightCompose, resolveStackEnvironment } from '../engine/magicVars.js';
import type { Template } from '../templates/registry.js';

/**
 * One-click compose-stack installs (`template.composeContent`). A stack is
 * stored exactly like any other service — same worker, same deploy history,
 * same Traefik finalize — except `type` is `'compose'`, the resolved magic
 * variables become ordinary persistent env rows, and the compose file is
 * materialised into the per-service workspace so the existing compose builder
 * can run it unchanged on every (re)deploy.
 */

const STACK_ROOT = path.resolve(config.paths.reposDir);

/** Workspace path for a service id, hard-locked to the repos root. */
function stackWorkspace(serviceId: number): string {
  const target = path.resolve(STACK_ROOT, path.join(STACK_ROOT, String(Number(serviceId))));
  if (!Number.isInteger(serviceId) || !target.startsWith(STACK_ROOT + path.sep)) {
    throw new Error('invalid workspace id');
  }
  return target;
}

export interface PreparedStack {
  service: Service;
  /** Env entries to reconcile through the shared template env machinery. */
  stackEnv: Array<{ key: string; value: string; secret: boolean }>;
  warnings: string[];
}

/**
 * Create/update the service row for a compose template and materialise its
 * files into the per-service workspace. Returns the generated environment for
 * the caller to persist idempotently via `reconcileEnvironment`.
 */
export async function prepareComposeStack(
  app: FastifyInstance,
  template: Template,
  input: { name?: string; reuseExisting?: boolean },
  user: { id: number; isOperator: boolean },
): Promise<PreparedStack> {
  const pre = preflightCompose(template.composeContent!);
  if (!pre.ok) throw badRequest(`Template compose definition cannot run here: ${pre.reasons.join('; ')}`);

  const name = input.name ?? template.name;
  const requestedSlug = input.name ? slugify(name) : `${slugify(template.name)}-${Date.now().toString(36).slice(-4)}`;

  let slug = requestedSlug;
  let service = await app.db.query.services.findFirst({ where: eq(services.slug, slug) });
  if (service && service.ownerUserId !== user.id && !user.isOperator) {
    // Same tenant-isolation rule as single-container templates: collide with
    // an invisible owner's slug by allocating a fresh one, never by leaking.
    let attempt = 0;
    do {
      slug = `${requestedSlug}-${randomToken(3).slice(0, 4)}`;
      service = await app.db.query.services.findFirst({ where: eq(services.slug, slug) });
    } while (service && ++attempt < 5);
    if (service) throw badRequest('Could not allocate a free service slug — try a different name');
  }

  if (service) {
    const sameStack =
      service.ownerUserId === user.id
      && service.type === 'compose'
      && service.templateId === template.id
      && ['idle', 'error', 'stopped', 'running'].includes(service.status);
    if (!(input.reuseExisting ?? true) || !sameStack) {
      throw badRequest(`A service with slug '${slug}' already exists`, 'slug_taken');
    }
    await app.db.update(services).set({ name }).where(eq(services.id, service.id));
    service = { ...service, name };
  } else {
    const [created] = await app.db.insert(services).values({
      ownerUserId: user.id,
      name,
      slug,
      type: 'compose',
      // Informational: Hub display + PREPARE skips git checkout because this
      // field is set (image deploys have no repository).
      image: template.image,
      port: template.port,
      publishedPort: null,
      healthPath: '/',
      repoUrl: null,
      cpuShares: 0,
      memLimitMb: 0,
      dockerSocket: false,
      templateId: template.id,
      // Routing target inside the compose project network.
      composeService: template.composeService,
    }).returning();
    if (!created) throw badRequest('Could not create template service');
    service = created;
    await app.db.insert(buildConfigs).values({ serviceId: service.id, buildPack: 'auto', baseDir: '/' });
  }

  // Wildcard domain decided BEFORE first boot so URL_/FQDN_ tokens baked into
  // containers match whatever finalize auto-assigns after it. Without a
  // wildcard there is no public URL yet — apps get localhost defaults they
  // can reconfigure later.
  const scheme = (await getAcmeEmail(app.db)) ? 'https' : 'http';
  const publicUrl = config.wildcardDomain ? `${scheme}://${service.slug}.${config.wildcardDomain}` : 'http://localhost';

  const resolved = resolveStackEnvironment(template.composeContent!, { publicUrl });

  const workDir = stackWorkspace(service.id);
  mkdirSync(workDir, { recursive: true });
  writeFileSync(path.join(workDir, 'docker-compose.yml'), template.composeContent!, { mode: 0o600 });

  const stackEnv = [
    ...Object.entries(resolved.values).map(([key, value]) => ({ key, value, secret: true })),
    ...(template.env ?? []).map((entry) => ({ key: entry.key, value: entry.value, secret: entry.secret ?? false })),
  ];
  return { service, stackEnv, warnings: pre.warnings };
}
