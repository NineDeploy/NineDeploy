import { eq } from 'drizzle-orm';
import { backups, databaseAttachments, databases, services, type Database } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createDatabase, setLimits } from '@ninedeploy/schemas';
import { connectionString, defaultPort, ENGINES, startDatabase, stopDatabase } from '../engine/database.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

const num = (v: string) => Number(v);

function serialize(d: Database) {
  const cfg = ENGINES[d.engine];
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
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Managed database CRUD. Mounted under /databases. */
export const databasesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const rows = await app.db.query.databases.findMany({ orderBy: (d, { desc }) => [desc(d.id)] });
    return rows.map(serialize);
  });

  app.post('/', async (req) => {
    const input = createDatabase.parse(req.body);
    const slug = slugify(input.name);
    const cfg = ENGINES[input.engine];
    if (!cfg) throw badRequest(`Unknown engine: ${input.engine}`);
    const password = randomToken(18);
    const containerName = `nd-db-${slug}`;
    const volumeName = `nd-db-${slug}-data`;

    const [created] = await app.db
      .insert(databases)
      .values({
        projectId: input.projectId ?? null,
        name: input.name,
        slug,
        engine: input.engine,
        version: input.version ?? null,
        status: 'creating',
        containerName,
        volumeName,
        username: cfg.username() ?? null,
        passwordEncrypted: encrypt(password),
        dbName: cfg.dbName() ?? null,
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

    const updated = await app.db.query.databases.findFirst({ where: eq(databases.id, created.id) });
    return serialize(updated!);
  });

  app.get('/:id', async (req) => {
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, num((req.params as { id: string }).id)) });
    if (!d) throw notFound('Database not found');
    return serialize(d);
  });

  app.delete('/:id', async (req) => {
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, num((req.params as { id: string }).id)) });
    if (!d) throw notFound('Database not found');
    await stopDatabase(d, (line) => app.log.info({ component: 'database' }, line));
    // Remove dependents explicitly (volume is intentionally kept = retained).
    await app.db.delete(databaseAttachments).where(eq(databaseAttachments.databaseId, d.id));
    await app.db.delete(backups).where(eq(backups.databaseId, d.id));
    await app.db.delete(databases).where(eq(databases.id, d.id));
    return { ok: true };
  });

  // Resource limits — recreates the container if running so they take effect.
  app.patch('/:id/limits', async (req) => {
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, num((req.params as { id: string }).id)) });
    if (!d) throw notFound('Database not found');
    const input = setLimits.parse(req.body);
    const [updated] = await app.db.update(databases).set(input).where(eq(databases.id, d.id)).returning();
    if (updated && updated.status === 'running') {
      await stopDatabase(updated, () => undefined);
      await startDatabase(updated, (line) => app.log.info({ component: 'database' }, line));
    }
    return { cpuShares: updated!.cpuShares, memLimitMb: updated!.memLimitMb };
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
    const input = (req.body ?? {}) as { databaseId?: number; envAlias?: string };
    const dbId = Number(input.databaseId);
    if (!dbId) throw badRequest('databaseId is required');
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');
    const d = await app.db.query.databases.findFirst({ where: eq(databases.id, dbId) });
    if (!d) throw notFound('Database not found');
    const envAlias = input.envAlias?.trim() || aliasFor(d.engine);
    const [a] = await app.db
      .insert(databaseAttachments)
      .values({ serviceId: id, databaseId: dbId, envAlias })
      .returning()
      .catch(() => [] as typeof databaseAttachments.$inferSelect[]);
    if (!a) throw badRequest('Already attached');
    return { id: a.id, databaseId: dbId, envAlias };
  });

  app.delete('/:id/attachments/:attId', async (req) => {
    const attId = num((req.params as { attId: string }).attId);
    await app.db.delete(databaseAttachments).where(eq(databaseAttachments.id, attId));
    return { ok: true };
  });
};
