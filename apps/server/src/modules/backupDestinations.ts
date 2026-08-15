import { eq } from 'drizzle-orm';
import { backupDestinations } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { audit } from '../lib/audit.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, notFound, parseId } from '../lib/errors.js';
import { s3Test } from '../lib/s3.js';

/**
 * S3-compatible backup destinations (admin only). The secret key is encrypted
 * at rest; updates may omit it to keep the stored one.
 */
export const backupDestinationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => {
    const rows = await app.db.query.backupDestinations.findMany();
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      endpoint: d.endpoint,
      region: d.region,
      bucket: d.bucket,
      prefix: d.prefix,
      active: d.active,
      createdAt: d.createdAt.toISOString(),
    }));
  });

  app.post('/', async (req) => {
    const input = (
      req.body ?? {}
    ) as {
      name?: unknown; endpoint?: unknown; region?: unknown; bucket?: unknown; prefix?: unknown; accessKeyId?: unknown; secretAccessKey?: unknown;
    };
    const name = String(input.name ?? '').trim();
    const endpoint = String(input.endpoint ?? '').trim();
    const bucket = String(input.bucket ?? '').trim();
    const accessKeyId = String(input.accessKeyId ?? '').trim();
    const secretAccessKey = String(input.secretAccessKey ?? '');
    if (!name || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw badRequest('name, endpoint, bucket, accessKeyId and secretAccessKey are required');
    }
    if (!/^https?:\/\//.test(endpoint)) throw badRequest('endpoint must be an http(s) URL');
    const [row] = await app.db
      .insert(backupDestinations)
      .values({
        name,
        endpoint,
        region: String(input.region ?? 'us-east-1').trim() || 'us-east-1',
        bucket,
        prefix: String(input.prefix ?? 'ninedeploy').trim() || 'ninedeploy',
        accessKeyId,
        secretKeyEncrypted: encrypt(secretAccessKey),
        active: true,
      })
      .returning();
    if (!row) throw badRequest('Could not create destination');
    void audit(app.db, req.user!.id, 'backup.destination.create', name);
    return { id: row.id };
  });

  app.patch('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = (req.body ?? {}) as Record<string, unknown>;
    const values: Partial<typeof backupDestinations.$inferInsert> = {};
    for (const key of ['name', 'endpoint', 'region', 'bucket', 'prefix'] as const) {
      if (typeof input[key] === 'string' && (input[key] as string).trim()) values[key] = (input[key] as string).trim();
    }
    if (typeof input.active === 'boolean') values.active = input.active;
    if (typeof input.accessKeyId === 'string' && input.accessKeyId.trim()) values.accessKeyId = input.accessKeyId.trim();
    if (typeof input.secretAccessKey === 'string' && input.secretAccessKey) {
      values.secretKeyEncrypted = encrypt(input.secretAccessKey);
    }
    const [row] = await app.db
      .update(backupDestinations)
      .set(values)
      .where(eq(backupDestinations.id, id))
      .returning();
    if (!row) throw notFound('Destination not found');
    void audit(app.db, req.user!.id, 'backup.destination.update', row.name);
    return { ok: true };
  });

  app.delete('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    await app.db.delete(backupDestinations).where(eq(backupDestinations.id, id));
    void audit(app.db, req.user!.id, 'backup.destination.delete', `#${id}`);
    return { ok: true };
  });

  // Connectivity + credentials probe: PUT + DELETE a tiny marker object.
  app.post('/:id/test', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const row = await app.db.query.backupDestinations.findFirst({ where: eq(backupDestinations.id, id) });
    if (!row) throw notFound('Destination not found');
    try {
      await s3Test({
        endpoint: row.endpoint,
        region: row.region,
        bucket: row.bucket,
        accessKeyId: row.accessKeyId,
        secretAccessKey: decrypt(row.secretKeyEncrypted),
      });
    } catch (err) {
      throw badRequest(`Destination unreachable: ${err instanceof Error ? err.message : err}`);
    }
    return { ok: true };
  });
};
