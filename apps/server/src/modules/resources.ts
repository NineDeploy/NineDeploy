import type { FastifyPluginAsync } from 'fastify';
import { capture, run } from '../lib/exec.js';
import { NETWORK } from '../engine/proxy.js';

function parseDf(line: string): Record<string, string> | null {
  try {
    return JSON.parse(line) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Docker resource accounting + image pruning. Mounted under /system. */
export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/resources', async () => {
    let images: Array<{ repo: string; tag: string; size: string }> = [];
    let summary = { total: '0', active: '0', size: '—', reclaimable: '—' };
    let containers = 0;
    let volumes = 0;

    try {
      const df = await capture('docker', ['system', 'df', '--format', '{{json .}}']);
      for (const line of df.split('\n')) {
        const row = parseDf(line);
        if (row && row['Type'] === 'Images') {
          summary = { total: row['Total'] ?? '0', active: row['Active'] ?? '0', size: row['Size'] ?? '—', reclaimable: row['Reclaimable'] ?? '—' };
        }
      }
    } catch {
      /* docker unavailable */
    }

    try {
      const out = await capture('docker', ['images', '--format', '{{.Repository}}|{{.Tag}}|{{.Size}}']);
      images = out
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [repo, tag, size] = l.split('|');
          return { repo: repo ?? '', tag: tag ?? '', size: size ?? '' };
        })
        .slice(0, 25);
    } catch {
      /* ignore */
    }

    try {
      containers = (await capture('docker', ['ps', '-q'])).split('\n').filter(Boolean).length;
      volumes = (await capture('docker', ['volume', 'ls', '-q'])).split('\n').filter(Boolean).length;
    } catch {
      /* ignore */
    }

    return { network: NETWORK, containers, volumes, imagesSummary: summary, images };
  });

  app.post('/prune-images', async (req) => {
    const log = (line: string) => req.log.info({ component: 'system' }, line);
    await run('docker', ['image', 'prune', '-f'], {}, log).catch(() => undefined);
    return { ok: true };
  });
};
