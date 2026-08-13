import { databases, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { removeVolume } from '../engine/database.js';
import { capture } from '../lib/exec.js';

/** Volume size for a named Docker volume (bytes), via a throwaway alpine container. */
async function volumeSize(name: string): Promise<number> {
  try {
    const out = await capture('docker', ['run', '--rm', '-v', `${name}:/v`, 'alpine', 'sh', '-c', 'du -sb /v']);
    return Number((out.trim().split(/\s+/)[0] ?? '0')) || 0;
  } catch {
    return 0;
  }
}

/** Inventory of NineDeploy-managed persistent volumes. Mounted under /volumes. */
export const volumeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const [svcs, dbs] = await Promise.all([app.db.select().from(services), app.db.select().from(databases)]);
    const svcBySlug = new Map(svcs.map((s) => [s.slug, s]));
    const dbBySlug = new Map(dbs.map((d) => [d.slug, d]));

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

    const out: Array<{ name: string; sizeBytes: number; owner: { kind: string; name: string; engine?: string } | null }> = [];
    for (const name of names) {
      let owner: { kind: string; name: string; engine?: string } | null = null;
      if (name.startsWith('nd-svc-')) {
        const slug = name.replace('nd-svc-', '').replace(/-data$/, '');
        const s = svcBySlug.get(slug);
        if (s) owner = { kind: 'service', name: s.name };
      } else {
        const slug = name.replace('nd-db-', '').replace(/-data$/, '');
        const d = dbBySlug.get(slug);
        if (d) owner = { kind: 'database', name: d.name, engine: d.engine };
      }
      out.push({ name, sizeBytes: await volumeSize(name), owner });
    }
    return out;
  });

  // Permanently delete a retained volume (the real, destructive cleanup).
  app.delete('/:name', async (req) => {
    const name = (req.params as { name: string }).name;
    if (!name.startsWith('nd-svc-') && !name.startsWith('nd-db-')) {
      return { ok: false, error: 'not a managed volume' };
    }
    await removeVolume(name, (line) => req.log.info(line));
    return { ok: true };
  });
};
