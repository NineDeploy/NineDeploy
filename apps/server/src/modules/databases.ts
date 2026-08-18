import { existsSync, unlinkSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { audit } from "../lib/audit.js";
import { backups, databaseAttachments, databases, services, type Database } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createAttachment, createDatabase, setLimits } from '@ninedeploy/schemas';
import {
  connectionString,
  databaseLogs,
  defaultPort,
  ENGINES,
  restartDatabase,
  startDatabase,
  startDatabaseStudio,
  stopDatabase,
  stopDatabaseStudio,
} from '../engine/database.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { badRequest, notFound, parseId as num } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

function serialize(
  d: Database & {
    attachments?: Array<{
      service?: { id: number; name: string; slug: string } | null;
    }>;
  },
) {
  const cfg = ENGINES[d.engine];
  const attachedServices =
    d.attachments
      ?.map((a) => (a.service ? { id: a.service.id, name: a.service.name, slug: a.service.slug } : null))
      .filter((s): s is { id: number; name: string; slug: string } => s != null) ?? [];

  return {
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    slug: d.slug,
    engine: d.engine,
    version: d.version,
    status: d.status,
    host: d.internalHost,
    port: d.internalPort,
    username: cfg?.username() ?? null,
    database: cfg?.dbName() ?? null,
    connectionString: d.status === 'running' ? connectionString(d) : null,
    containerName: d.containerName,
    volumeName: d.volumeName,
    cpuShares: d.cpuShares,
    memLimitMb: d.memLimitMb,
    webGuiEnabled: Boolean(d.webGuiEnabled),
    webGuiPort: d.webGuiPort,
    extensions: d.extensions,
    attachedServices,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Managed database CRUD. Mounted under /databases. */
export const databasesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    // Optional project scoping for the global project switcher (?projectId=).
    const projectId = Number((req.query as { projectId?: string }).projectId);
    const scoped = Number.isInteger(projectId) && projectId > 0 ? projectId : null;
    const rows = await app.db.query.databases.findMany({
      orderBy: (d, { desc }) => [desc(d.id)],
      with: {
        attachments: {
          with: {
            service: true,
          },
        },
      },
      ...(scoped != null && { where: (d, { eq }) => eq(d.projectId, scoped) }),
    });
    return rows.map(serialize);
  });

  app.post('/', async (req) => {
    const input = createDatabase.parse(req.body);
    const slug = slugify(input.name);
    const cfg = ENGINES[input.engine];
    if (!cfg) throw badRequest(`Unknown engine: ${input.engine}`);
    const password = randomToken(18);
    const containerName = `nd-db-${slug}`;
    const volumeName = input.existingVolume?.trim() ? input.existingVolume.trim() : `nd-db-${slug}-data`;
    const version = input.extensions?.includes('pgvector') && input.engine === 'postgres' ? 'vector' : (input.version ?? null);

    const [created] = await app.db
      .insert(databases)
      .values({
        projectId: input.projectId ?? null,
        name: input.name,
        slug,
        engine: input.engine,
        version,
        status: 'creating',
        containerName,
        volumeName,
        username: cfg.username() ?? null,
        passwordEncrypted: encrypt(password),
        dbName: cfg.dbName() ?? null,
        extensions: input.extensions ?? [],
        webGuiEnabled: input.webGuiEnabled ?? false,
      })
      .returning();
    if (!created) throw badRequest('Could not create database');

    try {
      await startDatabase(created, (line) => app.log.info({ component: 'database' }, line));
      await app.db
        .update(databases)
        .set({ status: 'running', internalHost: containerName, internalPort: defaultPort(input.engine) })
        .where(eq(databases.id, created.id));
    } catch (err) {
      await app.db.update(databases).set({ status: 'error' }).where(eq(databases.id, created.id));
      throw badRequest(`Failed to start database: ${err instanceof Error ? err.message : err}`);
    }

    const updated = await app.db.query.databases.findFirst({
      where: eq(databases.id, created.id),
      with: { attachments: { with: { service: true } } },
    });
    void audit(app.db, req.user!.id, 'database.create', input.name);
    return serialize(updated!);
  });

  app.get('/:id', async (req) => {
    const d = await app.db.query.databases.findFirst({
      where: eq(databases.id, num((req.params as { id: string }).id)),
      with: { attachments: { with: { service: true } } },
    });
    if (!d) throw notFound('Database not found');
    return serialize(d);
  });

  // Start Web Studio (Adminer / Redis Commander GUI) for this database
  app.post('/:id/studio', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    const port = (req.body as { port?: number })?.port ?? (d.webGuiPort || (18000 + (d.id % 1000)));
    await startDatabaseStudio(d, port, (line) => app.log.info({ component: 'database-studio' }, line));
    await app.db.update(databases).set({ webGuiEnabled: true, webGuiPort: port }).where(eq(databases.id, d.id));
    void audit(app.db, req.user!.id, 'database.studio.start', `${d.name} on :${port}`);
    return { ok: true, port, url: `http://${req.hostname.split(':')[0]}:${port}` };
  });

  // Stop Web Studio for this database
  app.delete('/:id/studio', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    await stopDatabaseStudio(d, (line) => app.log.info({ component: 'database-studio' }, line));
    await app.db.update(databases).set({ webGuiEnabled: false }).where(eq(databases.id, d.id));
    void audit(app.db, req.user!.id, 'database.studio.stop', d.name);
    return { ok: true };
  });

  app.delete('/:id', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({
      where: eq(databases.id, id),
      with: {
        attachments: {
          with: { service: true },
        },
      },
    });
    if (!d) throw notFound('Database not found');

    const attachedServices =
      d.attachments
        ?.map((a) => (a.service ? { id: a.service.id, name: a.service.name, slug: a.service.slug } : null))
        .filter((s): s is { id: number; name: string; slug: string } => s != null) ?? [];
    const force = (req.query as { force?: string }).force === 'true';

    // Guard against breaking connected services
    if (attachedServices.length > 0 && !force) {
      const names = attachedServices.map((s) => s.name).join(', ');
      throw badRequest(
        `Cannot delete database "${d.name}": It is locked and actively in use by ${attachedServices.length} service(s) (${names}). Detach these services first or pass ?force=true to override.`,
      );
    }

    await stopDatabase(d, (line) => app.log.info({ component: 'database' }, line));
    // Capture the dump paths BEFORE the transaction deletes the rows.
    const backupRows = await app.db.query.backups.findMany({ where: eq(backups.databaseId, d.id) });
    // Atomic row removal (attachments + backups + the database itself commit
    // together) — a mid-delete failure must never leave live rows pointing at
    // already-destroyed artifacts. The volume is intentionally kept = retained.
    await app.db.transaction(async (tx) => {
      await tx.delete(databaseAttachments).where(eq(databaseAttachments.databaseId, d.id));
      await tx.delete(backups).where(eq(backups.databaseId, d.id));
      await tx.delete(databases).where(eq(databases.id, d.id));
    });
    // Post-commit best-effort cleanup: unlink the dump files (dumps contain DB
    // credentials, plaintext once decrypted). Files are not transactional — a
    // failure here leaves an orphaned dump, which is logged, not silent.
    for (const b of backupRows) {
      try {
        if (existsSync(b.path)) unlinkSync(b.path);
      } catch (err) {
        req.log.warn({ err, path: b.path }, 'failed to unlink backup file after database delete');
      }
    }
    void audit(app.db, req.user!.id, 'database.delete', d.name);
    return { ok: true };
  });

  // Resource limits — recreates the container if running so they take effect.
  app.patch('/:id/limits', async (req) => {
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, num((req.params as { id: string }).id)) });
    if (!d) throw notFound('Database not found');
    const input = setLimits.parse(req.body);
    const updateData: { cpuShares?: number; memLimitMb?: number } = {};
    if (input.cpuShares !== undefined) {
      updateData.cpuShares = input.cpuShares && input.cpuShares > 0 ? input.cpuShares : 0;
    }
    if (input.memLimitMb !== undefined) {
      updateData.memLimitMb = input.memLimitMb && input.memLimitMb > 0 ? input.memLimitMb : 0;
    }
    const [updated] = await app.db.update(databases).set(updateData).where(eq(databases.id, d.id)).returning();
    if (updated && updated.status === 'running') {
      await stopDatabase(updated, () => undefined);
      await startDatabase(updated, (line) => app.log.info({ component: 'database' }, line));
    }
    return { cpuShares: updated!.cpuShares, memLimitMb: updated!.memLimitMb };
  });

  app.post('/:id/restart', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    await restartDatabase(d, (line) => app.log.info({ component: 'database' }, line));
    await app.db.update(databases).set({ status: 'running' }).where(eq(databases.id, d.id));
    void audit(app.db, req.user!.id, 'database.restart', d.name);
    return { ok: true };
  });

  app.post('/:id/stop', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    await stopDatabase(d, (line) => app.log.info({ component: 'database' }, line));
    await app.db.update(databases).set({ status: 'stopped' }).where(eq(databases.id, d.id));
    void audit(app.db, req.user!.id, 'database.stop', d.name);
    return { ok: true };
  });

  app.post('/:id/start', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    await startDatabase(d, (line) => app.log.info({ component: 'database' }, line));
    await app.db.update(databases).set({ status: 'running' }).where(eq(databases.id, d.id));
    void audit(app.db, req.user!.id, 'database.start', d.name);
    return { ok: true };
  });

  app.get('/:id/logs', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    const lines = Number((req.query as { lines?: string }).lines) || 100;
    const logs = await databaseLogs(d, lines);
    return { logs };
  });

  app.get('/:id/credentials', async (req) => {
    const id = num((req.params as { id: string }).id);
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, id) });
    if (!d) throw notFound('Database not found');
    const cfg = ENGINES[d.engine];
    const password = d.passwordEncrypted ? decrypt(d.passwordEncrypted) : '';
    const connStr = connectionString(d);
    return {
      engine: d.engine,
      username: cfg?.username() ?? d.username,
      password,
      database: cfg?.dbName() ?? d.dbName,
      internalHost: d.internalHost,
      internalPort: d.internalPort,
      connectionString: connStr,
    };
  });
};

// ── Service ↔ database attachments ────────────────────────────────────────
function aliasFor(engine: string): string {
  return engine === 'redis' ? 'REDIS_URL' : 'DATABASE_URL';
}

/** Attachment management. Mounted under /services. */
export const attachmentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/attachments', async (req) => {
    const id = num((req.params as { id: string }).id);
    const rows = await app.db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, id) });
    const out = [];
    for (const a of rows) {
      const d = await app.db.query.databases.findFirst({ where: eq(databases.id, a.databaseId) });
      out.push({ id: a.id, databaseId: a.databaseId, envAlias: a.envAlias, database: d ? { name: d.name, engine: d.engine, status: d.status } : null });
    }
    return out;
  });

  app.post('/:id/attachments', async (req) => {
    const id = num((req.params as { id: string }).id);
    // Validates databaseId (positive int) and the env alias charset — an alias
    // like `MY ALIAS` would otherwise be injected verbatim into the service's
    // runtime env and break `docker run --env-file` at deploy time.
    const input = createAttachment.parse(req.body ?? {});
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, input.databaseId) });
    if (!d) throw notFound('Database not found');
    const envAlias = input.envAlias ?? aliasFor(d.engine);
    const [a] = await app.db
      .insert(databaseAttachments)
      .values({ serviceId: id, databaseId: input.databaseId, envAlias })
      .returning()
      .catch(() => [] as typeof databaseAttachments.$inferSelect[]);
    if (!a) throw badRequest('Already attached');
    return { id: a.id, databaseId: input.databaseId, envAlias };
  });

  app.delete('/:id/attachments/:attId', async (req) => {
    const attId = num((req.params as { attId: string }).attId);
    await app.db.delete(databaseAttachments).where(eq(databaseAttachments.id, attId));
    return { ok: true };
  });
};
