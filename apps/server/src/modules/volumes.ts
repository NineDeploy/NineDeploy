import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { databases, services } from '@ninedeploy/db';
import { audit } from '../lib/audit.js';
import { removeVolume } from '../engine/database.js';
import { capture } from '../lib/exec.js';
import { containerRunning, resolveVolumeOwner } from '../lib/inventory.js';
import { badRequest, conflict } from '../lib/errors.js';

interface VolumeOwner {
  kind: string;
  name: string;
  engine?: string;
  containerName: string | null;
}

/**
 * Resolve the owner (service/database) of a managed volume name, if any.
 * Callers guarantee the name starts with nd-svc-/nd-db-; anything else is
 * ownerless (orphan) by definition.
 */
async function volumeOwner(db: FastifyInstance['db'], name: string): Promise<VolumeOwner | null> {
  const [svcs, dbs] = await Promise.all([db.select().from(services), db.select().from(databases)]);
  const owner = resolveVolumeOwner(svcs, dbs, name);
  if (!owner) return null;
  return { kind: owner.kind, name: owner.name, engine: owner.engine, containerName: owner.containerName };
}

/** Volume size for a named Docker volume (bytes), via a throwaway alpine container. */
async function volumeSize(name: string): Promise<number> {
  try {
    const out = await capture('docker', ['run', '--rm', '-v', `${name}:/v`, 'alpine', 'sh', '-c', 'du -sb /v']);
    return Number(out.trim().split(/\s+/)[0]!) || 0;
  } catch {
    return 0;
  }
}

/** Inventory of NineDeploy-managed persistent volumes. Mounted under /volumes. */
export const volumeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    let raw = '';
    try {
      raw = await capture('docker', ['volume', 'ls', '--format', '{{.Name}}']);
    } catch {
      return [];
    }

    const names = raw
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('nd-svc-') || n.startsWith('nd-db-'));

    const out: Array<{ name: string; sizeBytes: number; owner: { kind: string; name: string; engine?: string } | null; inUse: boolean }> = [];
    for (const name of names) {
      const owner = await volumeOwner(app.db, name);
      const inUse = owner ? await containerRunning(owner.containerName) : false;
      out.push({
        name,
        sizeBytes: await volumeSize(name),
        owner: owner ? { kind: owner.kind, name: owner.name, engine: owner.engine } : null,
        inUse,
      });
    }
    return out;
  });

  // Permanently delete a retained volume (the real, destructive cleanup).
  // Admin-only + audited: this irreversibly destroys a service's or database's
  // persistent data — so it REFUSES volumes whose owner's container is running
  // (stop the service/database first) and non-managed volume names.
  app.delete('/:name', { preHandler: [app.requireAdmin] }, async (req) => {
    const name = (req.params as { name: string }).name;
    if (!name.startsWith('nd-svc-') && !name.startsWith('nd-db-')) {
      throw badRequest('not a managed volume');
    }
    const owner = await volumeOwner(app.db, name);
    if (owner && (await containerRunning(owner.containerName))) {
      throw conflict(`Volume is in use by ${owner.kind} "${owner.name}" — stop it before deleting the volume`);
    }
    void audit(app.db, req.user!.id, 'volume.delete', name);
    await removeVolume(name, (line) => req.log.info(line));
    return { ok: true };
  });
};
