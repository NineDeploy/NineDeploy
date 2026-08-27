import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  buildConfigs,
  deployments,
  envVars,
  serviceLabels,
  serviceProjects,
  services,
  serviceWorkspaces,
  sources,
  type DB,
  type Service,
} from '@ninedeploy/db';
import { createService, setLimits, updateService } from '@ninedeploy/schemas';
import { getTemplates } from '../templates/registry.js';
import { capture } from '../lib/exec.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { badRequest, conflict, HttpError, notFound, parseId as num } from '../lib/errors.js';
import { loadServiceForUser } from '../lib/serviceAccess.js';
import { assertServiceRole, visibleServiceIdSet } from '../lib/resourceAccess.js';
import { assertMayUseHostPrivilege } from '../lib/hostPrivilege.js';
import { assertMayPublishPort } from '../lib/hostPort.js';
import { slugify } from '../lib/slug.js';
import { composeBuilder } from '../engine/builders/compose.js';
import { dockerBuilder } from '../engine/builders/docker.js';
import { pm2Builder, pm2Logs, pm2Restart, pm2Start, pm2Stop } from '../engine/builders/pm2.js';
import { writeDynamicConfig } from '../engine/proxy.js';
import { removeServiceBridgeIfEmpty } from '../lib/serviceBridge.js';
import { applyDefaultTags, replaceServiceTags } from './serviceTags.js';

/** The three tag id lists a service row is serialized with. */
interface TagIds {
  projectIds: number[];
  workspaceIds: number[];
  labelIds: number[];
}

const NO_TAGS: TagIds = { projectIds: [], workspaceIds: [], labelIds: [] };

/**
 * Read the project / workspace / label links of many services in three
 * queries rather than three per service. Returns an empty entry for a service
 * with no links so callers can index without a null check.
 */
async function loadTagIds(db: DB, serviceIds: number[]): Promise<Map<number, TagIds>> {
  const byId = new Map<number, TagIds>();
  if (serviceIds.length === 0) return byId;
  for (const id of serviceIds) byId.set(id, { projectIds: [], workspaceIds: [], labelIds: [] });

  const [projectLinks, workspaceLinks, labelLinks] = await Promise.all([
    db.query.serviceProjects.findMany({ where: inArray(serviceProjects.serviceId, serviceIds) }),
    db.query.serviceWorkspaces.findMany({ where: inArray(serviceWorkspaces.serviceId, serviceIds) }),
    db.query.serviceLabels.findMany({ where: inArray(serviceLabels.serviceId, serviceIds) }),
  ]);
  for (const link of projectLinks) byId.get(link.serviceId)?.projectIds.push(link.projectId);
  for (const link of workspaceLinks) byId.get(link.serviceId)?.workspaceIds.push(link.workspaceId);
  for (const link of labelLinks) byId.get(link.serviceId)?.labelIds.push(link.labelId);
  return byId;
}

/** Tag ids of a single service, in the shape `serialize` expects. */
async function tagIdsOf(db: DB, serviceId: number): Promise<TagIds> {
  return (await loadTagIds(db, [serviceId])).get(serviceId) ?? NO_TAGS;
}

/** Shape a DB row into the API representation (Date → ISO string). */
function serialize(s: Service, sourceName: string | null = null, tags: TagIds = NO_TAGS) {
  return {
    id: s.id,
    // Services link to any number of projects, workspaces and labels through
    // the join tables; the single `projectId` column is gone.
    projectIds: tags.projectIds,
    workspaceIds: tags.workspaceIds,
    labelIds: tags.labelIds,
    name: s.name,
    slug: s.slug,
    type: s.type,
    status: s.status,
    repoUrl: s.repoUrl,
    branch: s.branch,
    sourceId: s.sourceId,
    // Which stored credential private-repo cloning runs with — surfaced so
    // the UI can explain the link without exposing the token itself.
    sourceName: s.sourceId ? sourceName : null,
    image: s.image,
    volumeMount: s.volumeMount,
    composeService: s.composeService,
    commitSha: s.commitSha,
    runtimeId: s.runtimeId,
    serverId: s.serverId ?? null,
    healthPath: s.healthPath,
    port: s.port,
    publishedPort: s.publishedPort ?? null,
    autoUrl: config.wildcardDomain ? `${s.slug}.${config.wildcardDomain}` : null,
    cpuShares: s.cpuShares,
    memLimitMb: s.memLimitMb,
    previewDeploymentsEnabled: s.previewDeploymentsEnabled,
    previewAutoDestroyOnClose: s.previewAutoDestroyOnClose,
    previewDomainPattern: s.previewDomainPattern,
    previewMaxActive: s.previewMaxActive,
    isEphemeralPreview: s.isEphemeralPreview,
    previewParentServiceId: s.previewParentServiceId,
    prNumber: s.prNumber,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Build-config row → API representation. */
function serializeBuild(b: typeof buildConfigs.$inferSelect) {
  return {
    buildPack: b.buildPack,
    baseDir: b.baseDir,
    installCmd: b.installCmd,
    buildCmd: b.buildCmd,
    startCmd: b.startCmd,
    dockerfilePath: b.dockerfilePath,
    preDeployCmd: b.preDeployCmd,
    postDeployCmd: b.postDeployCmd,
    preStopCmd: b.preStopCmd,
    restartPolicy: b.restartPolicy,
    stopGraceSeconds: b.stopGraceSeconds,
  };
}

/** Resolve a service's credential display name (null = public / none). */
async function sourceNameFor(db: DB, sourceId: number | null): Promise<string | null> {
  if (!sourceId) return null;
  const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
  return src?.name ?? null;
}


export const servicesRoutes: FastifyPluginAsync = async (app) => {
  // Every route here requires authentication.
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    // The top bar filters on three independent dimensions. Within one group
    // the ids are OR-ed (any match); across groups they are AND-ed, so a
    // service must satisfy every group that was narrowed.
    const query = req.query as {
      tagProjectIds?: string;
      tagWorkspaceIds?: string;
      tagLabelIds?: string;
    };
    const ids = (raw: string | undefined): number[] =>
      (raw ?? '')
        .split(',')
        .map((part) => Number(part))
        .filter((n) => Number.isInteger(n) && n > 0);
    const wantedProjects = ids(query.tagProjectIds);
    const wantedWorkspaces = ids(query.tagWorkspaceIds);
    const wantedLabels = ids(query.tagLabelIds);

    // Visibility: owned services PLUS every service tagged into a workspace
    // the caller belongs to; operators see the whole instance.
    //
    // This used to filter on `ownerUserId` alone, which disagreed with
    // `/dashboard`, `/domains` and `loadServiceForUser` — all of which already
    // honoured workspace tags. A teammate could therefore open and deploy a
    // shared service by id while their own list came back empty and the
    // dashboard counted it. All four now call `visibleServiceIdSet`.
    const visibleIds = await visibleServiceIdSet(app.db, req.user!);
    const allRows = await app.db.query.services.findMany({
      orderBy: (s, { desc }) => [desc(s.id)],
    });
    const rows = visibleIds === null ? allRows : allRows.filter((s) => visibleIds.has(s.id));

    const tagsById = await loadTagIds(app.db, rows.map((s) => s.id));
    const matches = (have: number[], wanted: number[]) =>
      wanted.length === 0 || wanted.some((id) => have.includes(id));
    const visible = rows.filter((s) => {
      const tags = tagsById.get(s.id) ?? NO_TAGS;
      return (
        matches(tags.projectIds, wantedProjects) &&
        matches(tags.workspaceIds, wantedWorkspaces) &&
        matches(tags.labelIds, wantedLabels)
      );
    });

    // List view omits the build config (detail endpoint joins it); keep the shape stable.
    const sourceNames = new Map((await app.db.query.sources.findMany()).map((s) => [s.id, s.name]));
    return visible.map((s) => ({
      ...serialize(s, s.sourceId ? (sourceNames.get(s.sourceId) ?? null) : null, tagsById.get(s.id) ?? NO_TAGS),
      build: null,
    }));
  });

  app.post('/', async (req) => {
    const input = createService.parse(req.body);
    const template = input.templateId
      ? (await getTemplates(app.db)).find((candidate) => candidate.id === input.templateId)
      : undefined;
    if (input.templateId && !template) throw badRequest('Template not found');
    if (template && (
      input.type !== 'docker' ||
      input.image !== template.image ||
      input.port !== template.port ||
      (input.volumeMount ?? null) !== (template.volumeMount ?? null)
    )) throw badRequest('Template image, port and volume are registry-controlled');
    // Host-privilege gate: PM2/compose services, lifecycle hooks and
    // docker-socket templates all give host-level execution, which is exactly
    // what the admin-only exec/volume/container routes exist to withhold.
    assertMayUseHostPrivilege(req.user!, {
      type: input.type,
      dockerSocket: template?.dockerSocket ?? false,
      build: input.build,
    });
    assertMayPublishPort(req.user!, input.publishedPort);
    const slug = input.slug ?? slugify(input.name);
    // Explicit duplicate-slug check → a clean 409 instead of an uncaught
    // unique-index error (500). Covers the NULL-project case too, where
    // SQLite's unique index treats NULLs as distinct.
    const dup = await app.db.query.services.findFirst({ where: eq(services.slug, slug) });
    if (dup) {
      const sameDefinition =
        dup.ownerUserId === req.user!.id &&
        dup.type === input.type &&
        dup.repoUrl === (input.repoUrl ?? null) &&
        dup.branch === input.branch &&
        dup.sourceId === (input.sourceId ?? null) &&
        dup.serverId === (input.serverId ?? null) &&
        dup.image === (input.image ?? null) &&
        dup.volumeMount === (input.volumeMount ?? null) &&
        dup.composeService === (input.composeService ?? null) &&
        dup.port === (input.port ?? null) &&
        dup.publishedPort === (input.publishedPort ?? null);
      const reusable =
        input.reuseExisting === true &&
        dup.status === 'idle' &&
        sameDefinition &&
        (!template || (
          dup.templateId === template.id &&
          JSON.stringify(dup.templateDatabaseEnv) === JSON.stringify(template.databaseEnv ?? null) &&
          JSON.stringify(dup.cmd) === JSON.stringify(template.cmd ?? null) &&
          dup.dockerSocket === (template.dockerSocket ?? false)
        ));
      if (reusable) {
        void audit(app.db, req.user!.id, 'service.reuse', input.name);
        return serialize(dup, null, await tagIdsOf(app.db, dup.id));
      }
      // A failed/stopped Hub service may have been created from an older,
      // incomplete template contract (for example Ghost before its required
      // MySQL mapping was declared). A Hub retry is allowed to repair only the
      // registry-controlled fields of the same caller-owned definition. The
      // wizard then provisions/attaches the newly declared database before it
      // triggers another deployment.
      const repairableTemplate =
        input.reuseExisting === true &&
        template != null &&
        sameDefinition &&
        ['idle', 'error', 'stopped'].includes(dup.status);
      if (repairableTemplate) {
        const trusted = {
          templateId: template.id,
          templateDatabaseEnv: template.databaseEnv ?? null,
          cmd: template.cmd ?? null,
          dockerSocket: template.dockerSocket ?? false,
        };
        await app.db.update(services).set(trusted).where(eq(services.id, dup.id));
        void audit(app.db, req.user!.id, 'service.repair_template', input.name);
        return serialize({ ...dup, ...trusted }, null, await tagIdsOf(app.db, dup.id));
      }
      throw badRequest(`A service with slug '${slug}' already exists`, 'slug_taken');
    }
    const [svc] = await app.db
      .insert(services)
      .values({
        ownerUserId: req.user!.id,
        name: input.name,
        slug,
        type: input.type,
        repoUrl: input.repoUrl,
        branch: input.branch,
        sourceId: input.sourceId ?? null,
        image: input.image ?? null,
        volumeMount: input.volumeMount ?? null,
        composeService: input.composeService ?? null,
        serverId: input.serverId ?? null,
        cpuShares: input.cpuShares ?? 0,
        memLimitMb: input.memLimitMb ?? 0,
        port: input.port ?? null,
        publishedPort: input.publishedPort ?? null,
        cmd: template?.cmd ?? null,
        dockerSocket: template?.dockerSocket ?? false,
        templateId: template?.id ?? null,
        templateDatabaseEnv: template?.databaseEnv ?? null,
        previewDeploymentsEnabled: input.previewDeploymentsEnabled ?? false,
        previewAutoDestroyOnClose: input.previewAutoDestroyOnClose ?? true,
        previewDomainPattern: input.previewDomainPattern ?? null,
        previewMaxActive: input.previewMaxActive ?? 5,
      })
      .returning();
    if (!svc) throw notFound('Could not create service');
    await app.db
      .insert(buildConfigs)
      .values({
        serviceId: svc.id,
        buildPack: input.build.buildPack,
        baseDir: input.build.baseDir,
        installCmd: input.build.installCmd ?? null,
        buildCmd: input.build.buildCmd ?? null,
        startCmd: input.build.startCmd ?? null,
        dockerfilePath: input.build.dockerfilePath ?? null,
        preDeployCmd: input.build.preDeployCmd ?? null,
        postDeployCmd: input.build.postDeployCmd ?? null,
        preStopCmd: input.build.preStopCmd ?? null,
        restartPolicy: input.build.restartPolicy ?? 'unless-stopped',
        stopGraceSeconds: input.build.stopGraceSeconds ?? 5,
      });
    // Tagging is a separate concern from the row itself: an explicit tag set
    // wins, otherwise the service lands in every workspace the caller belongs
    // to so it is visible to their team by default.
    if (input.tagProjectIds || input.tagWorkspaceIds || input.tagLabelIds) {
      await replaceServiceTags(
        app.db,
        svc!.id,
        input.tagProjectIds ?? [],
        input.tagWorkspaceIds ?? [],
        input.tagLabelIds ?? [],
      );
    } else {
      await applyDefaultTags(app.db, req.user!, svc!.id);
    }
    void audit(app.db, req.user!.id, 'service.create', input.name);
    return serialize(svc, await sourceNameFor(app.db, svc.sourceId), await tagIdsOf(app.db, svc!.id));
  });

  app.get('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const svc = await loadServiceForUser(app.db, id, req.user!);
    const build = await app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, id) });
    return {
      ...serialize(svc, await sourceNameFor(app.db, svc.sourceId), await tagIdsOf(app.db, svc.id)),
      build: build ? serializeBuild(build) : null,
    };
  });

  app.patch('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const existing = await loadServiceForUser(app.db, id, req.user!);
    // Read access is any workspace seat; editing the definition is `member`+.
    await assertServiceRole(app.db, existing, req.user!, 'member');
    const { build, ...patch } = updateService.parse(req.body ?? {});
    // The gate has to consider the MERGED result, not just the payload: a
    // member could otherwise switch `type` to pm2 on its own, or add a single
    // lifecycle hook, and reach host execution one field at a time.
    const currentBuild = await app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, id) });
    const merged = (key: 'preDeployCmd' | 'postDeployCmd' | 'preStopCmd') =>
      build?.[key] !== undefined ? build[key] : currentBuild?.[key];
    assertMayUseHostPrivilege(req.user!, {
      type: patch.type ?? existing.type,
      dockerSocket: existing.dockerSocket ?? false,
      build: {
        preDeployCmd: merged('preDeployCmd'),
        postDeployCmd: merged('postDeployCmd'),
        preStopCmd: merged('preStopCmd'),
      },
    });
    // Same merged-result reasoning for the host port.
    assertMayPublishPort(req.user!, patch.publishedPort === undefined ? existing.publishedPort : patch.publishedPort);
    // Build-config keys are optional; null out omitted-but-cleared ones via `set` semantics.
    const [svc] = await app.db.update(services).set(patch).where(eq(services.id, id)).returning();
    if (!svc) throw notFound('Service not found');
    if (build) {
      // Only overwrite the keys the client sent — a PATCH must not reset the
      // rest of the build config back to defaults.
      const values: Partial<typeof buildConfigs.$inferInsert> = {};
      if (build.buildPack !== undefined) values.buildPack = build.buildPack;
      if (build.baseDir !== undefined) values.baseDir = build.baseDir;
      if (build.restartPolicy !== undefined) values.restartPolicy = build.restartPolicy;
      if (build.stopGraceSeconds !== undefined) values.stopGraceSeconds = build.stopGraceSeconds;
      for (const key of ['installCmd', 'buildCmd', 'startCmd', 'dockerfilePath', 'preDeployCmd', 'postDeployCmd', 'preStopCmd'] as const) {
        const v = build[key];
        if (v !== undefined) values[key] = v === '' ? null : v;
      }
      if (Object.keys(values).length > 0) {
        const updated = await app.db.update(buildConfigs).set(values).where(eq(buildConfigs.serviceId, id)).returning();
        if (updated.length === 0) throw notFound('Service not found');
      }
    }
    // The internal container port is also Traefik's upstream port. Apply a
    // manual correction to routing immediately for an already-running service;
    // the next redeploy will additionally pass it to buildpack apps as $PORT.
    if (patch.port !== undefined && svc.runtimeId) {
      try {
        await writeDynamicConfig(app.db);
      } catch (err) {
        req.log.warn({ err, serviceId: id, port: patch.port }, 'failed to rewrite traefik config after container port update');
      }
    }
    void audit(app.db, req.user!.id, 'service.update', svc.name);
    return serialize(svc, await sourceNameFor(app.db, svc.sourceId), await tagIdsOf(app.db, svc.id));
  });

  app.delete('/:id', async (req, reply) => {
    const id = num((req.params as { id: string }).id);
    const svc = await loadServiceForUser(app.db, id, req.user!);
    // Destroying a service (and its volumes) is an `admin`+ action.
    await assertServiceRole(app.db, svc, req.user!, 'admin');
    // A deployment queued or building for this service keeps writing state
    // against the row and its candidate runtime. Deleting now would orphan the
    // mid-flight build's runtime — refuse until the pipeline settles; the user
    // can cancel first.
    const activeDeploy = await app.db.query.deployments.findFirst({
      where: and(eq(deployments.serviceId, id), inArray(deployments.status, ['queued', 'building'])),
    });
    if (activeDeploy) {
      throw conflict('A deployment is queued or building — cancel it or wait for it to finish before deleting');
    }
    // Row first (a single DELETE is atomic; FK cascade removes the build
    // config, env vars, domains and deployments) — a failed delete must never
    // leave a live row whose runtime has already been destroyed.
    await app.db.delete(services).where(eq(services.id, id));
    // Rewrite Traefik routing — the service's domains cascade-deleted with the
    // row, so its routers/services drop out of the dynamic config. Routing must
    // never block delete, so failures are logged, not thrown.
    try {
      await writeDynamicConfig(app.db);
    } catch (err) {
      req.log.warn({ err }, 'failed to rewrite traefik config after service delete');
    }
    // Retire the runtime AFTER the row commit — mirrors the blue-green rule
    // (routing flips before the old container stops). Both builders' `stop` is
    // contractually non-throwing (they swallow missing/dead runtimes). An
    // unknown type cannot silently misroute to the docker teardown.
    if (svc.runtimeId) {
      if (svc.type === 'pm2') await pm2Builder.stop(svc.runtimeId);
      else if (svc.type === 'docker') await dockerBuilder.stop(svc.runtimeId);
      else if (svc.type === 'compose') await composeBuilder.stop(svc.runtimeId);
      else req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — leaving runtime in place');
    }
    // Model B: reap the service's private bridge. A no-op when a database is
    // still attached to it (so the DB keeps resolving the service's bridge
    // and the panel can still show the connection). Failures are logged, not
    // thrown — the row is already gone and a stale bridge is recoverable.
    try {
      await removeServiceBridgeIfEmpty(svc.slug, (line) => req.log.info({ bridge: svc.slug }, line));
    } catch (err) {
      req.log.warn({ err, slug: svc.slug }, 'failed to reap per-service bridge');
    }
    void audit(app.db, req.user!.id, 'service.delete', svc.name);
    reply.status(204);
  });

  // Resource limits (applied on next deploy).
  app.patch('/:id/limits', async (req) => {
    const id = num((req.params as { id: string }).id);
    const limitTarget = await loadServiceForUser(app.db, id, req.user!);
    await assertServiceRole(app.db, limitTarget, req.user!, 'member');
    const input = setLimits.parse(req.body);
    const updateData: { cpuShares?: number; memLimitMb?: number } = {};
    if (input.cpuShares !== undefined) {
      updateData.cpuShares = input.cpuShares && input.cpuShares > 0 ? input.cpuShares : 0;
    }
    if (input.memLimitMb !== undefined) {
      updateData.memLimitMb = input.memLimitMb && input.memLimitMb > 0 ? input.memLimitMb : 0;
    }
    const [svc] = await app.db.update(services).set(updateData).where(eq(services.id, id)).returning();
    if (!svc) throw notFound('Service not found');
    return { cpuShares: svc.cpuShares, memLimitMb: svc.memLimitMb };
  });

  // ── Lifecycle: stop / start / restart ──────────────────────────────────
  // PM2 services run as host processes under the PM2 daemon and must be
  // managed through it — `docker stop/start/restart` would silently no-op on a
  // PM2 process name. Docker services are managed through the docker CLI.
  //
  // These endpoints must tell the truth about the runtime: swallowing a
  // Docker/PM2 failure while still writing `running`/`stopped` to the database
  // makes the panel report containers that do not exist (typically after a
  // reboot or daemon outage). capture() rejections carry the CLI's stderr,
  // which separates "the runtime is gone" (idempotent stop / needs redeploy)
  // from "the daemon itself is unreachable".
  const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  const isMissingRuntime = (err: unknown): boolean =>
    /no such container|no such object|no such process|process (name )?not found|not found/i.test(errText(err));
  const isDaemonDown = (err: unknown): boolean =>
    /cannot connect to the docker daemon|docker daemon is not running|error during connect|is the docker daemon running/i.test(
      errText(err),
    );
  const daemonUnavailable = (err: unknown): HttpError =>
    new HttpError(503, 'runtime_daemon_unavailable', `Docker daemon is unreachable: ${errText(err)}`);
  const runtimeGone = (kind: string, runtimeId: string): HttpError =>
    conflict(`${kind} "${runtimeId}" no longer exists — redeploy the service to recreate it`);

  app.post('/:id/stop', async (req) => {
    const svc = await loadServiceForUser(app.db, num((req.params as { id: string }).id), req.user!);
    await assertServiceRole(app.db, svc, req.user!, 'member');
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    // PM2 and Docker have disjoint runtimes — an unknown type must not silently
    // misroute to the docker CLI (which would no-op on a PM2 process name).
    if (svc.type === 'pm2') {
      // Stopping a process that is already gone is success, not failure.
      await pm2Stop(svc.runtimeId).catch((err: unknown) => {
        if (!isMissingRuntime(err)) throw err;
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'pm2 process already gone; stop is idempotent');
      });
    } else if (svc.type === 'docker' || svc.type === 'compose') {
      await capture('docker', ['stop', '-t', '5', svc.runtimeId]).catch((err: unknown) => {
        if (isDaemonDown(err)) throw daemonUnavailable(err);
        if (!isMissingRuntime(err)) throw err;
        req.log.warn({ err, runtimeId: svc.runtimeId }, 'container already gone; stop is idempotent');
      });
    } else {
      req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — cannot stop runtime');
      throw badRequest('Unsupported service type');
    }
    await app.db.update(services).set({ status: 'stopped' }).where(eq(services.id, svc.id));
    void audit(app.db, req.user!.id, 'service.stop', svc.name);
    return { ok: true, status: 'stopped' };
  });

  app.post('/:id/start', async (req) => {
    const svc = await loadServiceForUser(app.db, num((req.params as { id: string }).id), req.user!);
    await assertServiceRole(app.db, svc, req.user!, 'member');
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    if (svc.type === 'pm2') {
      await pm2Start(svc.runtimeId).catch(async (err: unknown) => {
        if (isMissingRuntime(err)) {
          await app.db.update(services).set({ status: 'error' }).where(eq(services.id, svc.id));
          throw runtimeGone('PM2 process', svc.runtimeId!);
        }
        throw err;
      });
    } else if (svc.type === 'docker' || svc.type === 'compose') {
      await capture('docker', ['start', svc.runtimeId]).catch(async (err: unknown) => {
        if (isDaemonDown(err)) throw daemonUnavailable(err);
        if (isMissingRuntime(err)) {
          await app.db.update(services).set({ status: 'error' }).where(eq(services.id, svc.id));
          throw runtimeGone('Container', svc.runtimeId!);
        }
        throw err;
      });
    } else {
      req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — cannot start runtime');
      throw badRequest('Unsupported service type');
    }
    await app.db.update(services).set({ status: 'running' }).where(eq(services.id, svc.id));
    void audit(app.db, req.user!.id, 'service.start', svc.name);
    return { ok: true, status: 'running' };
  });

  app.post('/:id/restart', async (req) => {
    const svc = await loadServiceForUser(app.db, num((req.params as { id: string }).id), req.user!);
    await assertServiceRole(app.db, svc, req.user!, 'member');
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    if (svc.type === 'pm2') {
      await pm2Restart(svc.runtimeId).catch(async (err: unknown) => {
        if (isMissingRuntime(err)) {
          await app.db.update(services).set({ status: 'error' }).where(eq(services.id, svc.id));
          throw runtimeGone('PM2 process', svc.runtimeId!);
        }
        throw err;
      });
    } else if (svc.type === 'docker' || svc.type === 'compose') {
      await capture('docker', ['restart', svc.runtimeId]).catch(async (err: unknown) => {
        if (isDaemonDown(err)) throw daemonUnavailable(err);
        if (isMissingRuntime(err)) {
          await app.db.update(services).set({ status: 'error' }).where(eq(services.id, svc.id));
          throw runtimeGone('Container', svc.runtimeId!);
        }
        throw err;
      });
    } else {
      req.log.warn({ type: svc.type, runtimeId: svc.runtimeId }, 'unsupported service type — cannot restart runtime');
      throw badRequest('Unsupported service type');
    }
    // docker restart / pm2.restart bring a stopped runtime back up — persist
    // the transition, or a stop → restart flow would forever show 'stopped'.
    await app.db.update(services).set({ status: 'running' }).where(eq(services.id, svc.id));
    void audit(app.db, req.user!.id, 'service.restart', svc.name);
    return { ok: true, status: 'running' };
  });

  // Runtime logs: PM2 reads the daemon's log files; Docker reads container logs.
  app.get('/:id/logs', async (req) => {
    const svc = await loadServiceForUser(app.db, num((req.params as { id: string }).id), req.user!);
    if (!svc?.runtimeId) throw notFound('Service not found or not deployed');
    if (svc.type === 'pm2') {
      try {
        return { lines: await pm2Logs(svc.runtimeId) };
      } catch {
        return { lines: '' };
      }
    }
    try {
      const out = await capture('docker', ['logs', '--tail', '300', '--timestamps', svc.runtimeId]);
      return { lines: out };
    } catch {
      return { lines: '' };
    }
  });

  app.post('/:id/clone', async (req) => {
    const id = num((req.params as { id: string }).id);
    const body = (req.body as { name?: string; slug?: string } | undefined) ?? {};
    const svc = await loadServiceForUser(app.db, id, req.user!);
    // A clone inherits the source's type and build config — including its
    // lifecycle hooks — so it inherits its host privilege too.
    const sourceBuild = await app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, id) });
    assertMayUseHostPrivilege(req.user!, {
      type: svc.type,
      dockerSocket: svc.dockerSocket ?? false,
      build: sourceBuild ?? null,
    });

    const newName = body.name?.trim() || `${svc.name} (Copy)`;
    let newSlug = body.slug?.trim() ? slugify(body.slug) : slugify(newName);

    // Ensure unique slug. Bounded: a pathological number of collisions (or a
    // test/DB layer that answers every probe with a row) must not spin forever.
    let counter = 1;
    while (await app.db.query.services.findFirst({ where: eq(services.slug, newSlug) })) {
      if (counter > 50) {
        newSlug = `${slugify(newName)}-${Date.now().toString(36)}`;
        break;
      }
      newSlug = `${slugify(newName)}-${counter++}`;
    }

    const [created] = await app.db
      .insert(services)
      .values({
        ownerUserId: req.user!.id,
        name: newName,
        slug: newSlug,
        type: svc.type,
        status: 'idle',
        repoUrl: svc.repoUrl,
        branch: svc.branch,
        sourceId: svc.sourceId,
        image: svc.image,
        volumeMount: svc.volumeMount,
        composeService: svc.composeService,
        healthPath: svc.healthPath,
        port: svc.port,
        publishedPort: null, // do not collide host port
        cpuShares: svc.cpuShares,
        memLimitMb: svc.memLimitMb,
        previewDeploymentsEnabled: svc.previewDeploymentsEnabled,
        previewAutoDestroyOnClose: svc.previewAutoDestroyOnClose,
        previewDomainPattern: svc.previewDomainPattern,
        previewMaxActive: svc.previewMaxActive,
      })
      .returning();

    // Clone build config if exists
    const b = await app.db.query.buildConfigs.findFirst({ where: eq(buildConfigs.serviceId, svc.id) });
    if (b) {
      await app.db.insert(buildConfigs).values({
        serviceId: created!.id,
        buildPack: b.buildPack,
        baseDir: b.baseDir,
        installCmd: b.installCmd,
        buildCmd: b.buildCmd,
        startCmd: b.startCmd,
        dockerfilePath: b.dockerfilePath,
        preDeployCmd: b.preDeployCmd,
        postDeployCmd: b.postDeployCmd,
        preStopCmd: b.preStopCmd,
        restartPolicy: b.restartPolicy,
        stopGraceSeconds: b.stopGraceSeconds,
      });
    }

    // Clone env vars
    const envs = await app.db.query.envVars.findMany({ where: eq(envVars.serviceId, svc.id) });
    for (const env of envs) {
      await app.db.insert(envVars).values({
        serviceId: created!.id,
        key: env.key,
        valueEncrypted: env.valueEncrypted,
        scope: env.scope,
        scopeKey: env.scope === 'service' ? created!.id : env.scopeKey,
        isSecret: env.isSecret,
      });
    }

    void audit(app.db, req.user!.id, 'service.clone', `${svc.name} -> ${created!.name}`);
    // The clone belongs wherever the original did.
    const sourceTags = await tagIdsOf(app.db, svc.id);
    await replaceServiceTags(
      app.db,
      created!.id,
      sourceTags.projectIds,
      sourceTags.workspaceIds,
      sourceTags.labelIds,
    );
    return serialize(created!, await sourceNameFor(app.db, created!.sourceId), await tagIdsOf(app.db, created!.id));
  });
};
