import {
  databaseAttachments,
  databases,
  type Database,
  type DB,
  services,
  type Service,
} from '@ninedeploy/db';
import { eq } from 'drizzle-orm';
import { encrypt, randomToken } from '../lib/crypto.js';
import { getTemplates } from '../templates/registry.js';
import { attachDatabaseToServiceBridges, defaultPort, ENGINES, startDatabase } from './database.js';

export type TemplateDependencyResult = { database: Database; alreadyAttached: boolean } | null;

/**
 * Idempotently reconcile the durable Hub contract attached to a service.
 * This deliberately lives in the worker-owned pipeline, not an HTTP request:
 * retries reuse the same DB/volume/attachment and process restarts resume it.
 */
export async function reconcileTemplateDependencies(
  db: DB,
  service: Service,
  log: (line: string) => void,
): Promise<TemplateDependencyResult> {
  if (!service.templateId) return null;
  const template = (await getTemplates(db)).find((candidate) => candidate.id === service.templateId);
  if (!template) throw new Error(`Hub template '${service.templateId}' is no longer available`);
  if (!template.dbEngine) return null;

  const cfg = ENGINES[template.dbEngine];
  if (!cfg || !template.databaseEnv) throw new Error(`Template '${template.id}' has an invalid database contract`);

  const attachments = await db.query.databaseAttachments.findMany({ where: eq(databaseAttachments.serviceId, service.id) });
  let database: Database | undefined;
  let alreadyAttached = false;
  for (const attachment of attachments) {
    const candidate = await db.query.databases.findFirst({ where: eq(databases.id, attachment.databaseId) });
    if (candidate?.engine === template.dbEngine) {
      if (candidate.ownerUserId !== service.ownerUserId || candidate.projectId !== service.projectId) {
        throw new Error('Attached template database belongs to another resource');
      }
      database = candidate;
      alreadyAttached = true;
      break;
    }
  }

  const dbSlug = `${service.slug}-db`;
  if (!database) {
    const retained = await db.query.databases.findFirst({ where: eq(databases.slug, dbSlug) });
    if (retained) {
      if (
        retained.ownerUserId !== service.ownerUserId
        || retained.projectId !== service.projectId
        || retained.engine !== template.dbEngine
      ) {
        throw new Error(`Database slug '${dbSlug}' belongs to another resource`);
      }
      database = retained;
    }
  }

  if (!database) {
    const [created] = await db.insert(databases).values({
      projectId: service.projectId,
      ownerUserId: service.ownerUserId,
      name: `${service.name} DB`,
      slug: dbSlug,
      engine: template.dbEngine,
      status: 'creating',
      containerName: `nd-db-${dbSlug}`,
      volumeName: `nd-db-${dbSlug}-data`,
      username: cfg.username() ?? null,
      passwordEncrypted: encrypt(randomToken(18)),
      dbName: cfg.dbName() ?? null,
      extensions: [],
      webGuiEnabled: false,
    }).returning();
    if (!created) throw new Error('Could not create template database');
    database = created;
  }

  log(`Ensuring ${template.dbEngine} dependency ${database.slug} is running …`);
  try {
    await startDatabase(database, log);
    // Model B: the DB must also live on the service's per-slug bridge so the
    // app can reach it by name without being able to reach other services.
    await attachDatabaseToServiceBridges(database, [service.slug], log);
    await db.update(databases).set({
      status: 'running',
      internalHost: database.containerName,
      internalPort: defaultPort(database.engine),
    }).where(eq(databases.id, database.id));
  } catch (error) {
    await db.update(databases).set({ status: 'error' }).where(eq(databases.id, database.id));
    await db.update(services).set({ status: 'error' }).where(eq(services.id, service.id));
    throw new Error(`Failed to start template database: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!alreadyAttached) {
    await db.insert(databaseAttachments).values({
      serviceId: service.id,
      databaseId: database.id,
      envAlias: template.dbEngine === 'redis' || template.dbEngine === 'valkey' ? 'REDIS_URL' : 'DATABASE_URL',
    });
  }

  return {
    database: {
      ...database,
      status: 'running',
      internalHost: database.containerName,
      internalPort: defaultPort(database.engine),
    },
    alreadyAttached,
  };
}
