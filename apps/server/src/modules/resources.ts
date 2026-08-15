import { createReadStream, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { count } from 'drizzle-orm';
import { databases, deployments, services, users } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { capture, run } from '../lib/exec.js';
import { config } from '../config.js';
import { checkForUpdate } from '../lib/updateCheck.js';
import { NETWORK } from '../engine/proxy.js';

function parseDf(line: string): Record<string, string> | null {
  try { return JSON.parse(line) as Record<string, string>; } catch { return null; }
}

/** Docker resource accounting + image pruning + export/import. Mounted under /system. */
export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  // System resources, prune, export/import — admin-only (host-level operations).
  app.addHook('preHandler', app.requireAdmin);

  // Latest-release check (GitHub Releases feed, 6h cache; "unknown" when
  // offline or disabled — never throws so the dashboard stays usable).
  app.get('/update-check', async (req) => checkForUpdate((req.query as { force?: string })?.force === '1'));

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
    } catch { /* docker unavailable */ }

    try {
      const out = await capture('docker', ['images', '--format', '{{.Repository}}|{{.Tag}}|{{.Size}}']);
      images = out.split('\n').filter(Boolean).map((l) => {
        const [repo, tag, size] = l.split('|');
        return { repo: repo!, tag: tag ?? '', size: size ?? '' };
      }).slice(0, 25);
    } catch { /* ignore */ }

    try {
      containers = (await capture('docker', ['ps', '-q'])).split('\n').filter(Boolean).length;
      volumes = (await capture('docker', ['volume', 'ls', '-q'])).split('\n').filter(Boolean).length;
    } catch { /* ignore */ }

    return { network: NETWORK, containers, volumes, imagesSummary: summary, images };
  });

  app.post('/prune-images', async (req) => {
    const log = (line: string) => req.log.info({ component: 'system' }, line);
    await run('docker', ['image', 'prune', '-f'], {}, log).catch(() => undefined);
    return { ok: true };
  });

  // ── Export: download a tar.gz of the entire system state ──────────────
  app.get('/export', async (_req, reply) => {
    const files: string[] = [];
    // Unique temp names so two concurrent exports can't delete each other's
    // artifacts mid-stream via the finally-cleanup below.
    const stamp = `${process.pid}-${Date.now()}`;
    const archive = path.join(config.paths.dataDir, `ninedeploy-backup-${stamp}.tar.gz`);
    const envTmp = `_env-${stamp}`;
    const metaTmp = `_meta-${stamp}.json`;

    try {
      const dbRel = path.relative(config.paths.dataDir, config.paths.dbFile);
      if (existsSync(config.paths.dbFile)) files.push(dbRel);
      if (existsSync(config.paths.masterKeyFile)) files.push(path.relative(config.paths.dataDir, config.paths.masterKeyFile));
      const envFile = path.join(process.cwd(), '.env');
      if (existsSync(envFile)) {
        writeFileSync(path.join(config.paths.dataDir, envTmp), readFileSync(envFile, 'utf8'));
        files.push(envTmp);
      }
      const traefikDir = path.join(config.paths.dataDir, 'traefik');
      if (existsSync(traefikDir)) files.push('traefik');

      const [s, d, dep, u] = await Promise.all([
        app.db.select({ n: count() }).from(services),
        app.db.select({ n: count() }).from(databases),
        app.db.select({ n: count() }).from(deployments),
        app.db.select({ n: count() }).from(users),
      ]);
      const meta = {
        version: '1.0.0', exportedAt: new Date().toISOString(),
        stats: { services: s[0]?.n ?? 0, databases: d[0]?.n ?? 0, deployments: dep[0]?.n ?? 0, users: u[0]?.n ?? 0 },
        files,
      };
      writeFileSync(path.join(config.paths.dataDir, metaTmp), JSON.stringify(meta, null, 2));
      files.push(metaTmp);

      await new Promise<void>((resolve, reject) => {
        const child = spawn('tar', ['-czf', archive, '-C', config.paths.dataDir, ...files]);
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
      });

      const size = statSync(archive).size;
      reply.type('application/gzip')
        .header('content-disposition', `attachment; filename="ninedeploy-backup-${new Date().toISOString().slice(0, 10)}.tar.gz"`)
        .header('content-length', size);
      return reply.send(createReadStream(archive));
    } finally {
      try { unlinkSync(path.join(config.paths.dataDir, envTmp)); } catch { /* */ }
      try { unlinkSync(path.join(config.paths.dataDir, metaTmp)); } catch { /* */ }
      try { unlinkSync(archive); } catch { /* */ }
    }
  });

  // ── Import: upload a tar.gz and restore system state ──────────────────
  app.post('/import', async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== 'string') {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'No body received' } });
    }

    const tmpDir = path.join(config.paths.dataDir, '_import');
    const archivePath = path.join(tmpDir, 'upload.tar.gz');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(archivePath, Buffer.from(body, 'binary'));

    // Tar-slip guard: list the members FIRST and refuse anything that would
    // escape the extraction dir (absolute paths, .., or a parent ref) — GNU tar
    // strips leading '/' but happily extracts '../..' entries.
    const listing = await new Promise<string>((resolve, reject) => {
      let out = '';
      const child = spawn('tar', ['-tzf', archivePath]);
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`tar list exited ${code}`))));
    });
    const safe = (name: string) =>
      !name.startsWith('/') && !name.split('/').includes('..') && !path.isAbsolute(name);
    for (const member of listing.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (!safe(member)) {
        rmSync(tmpDir, { recursive: true, force: true });
        return reply.status(400).send({ error: { code: 'bad_request', message: `Invalid archive: unsafe member ${JSON.stringify(member)}` } });
      }
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xzf', archivePath, '-C', tmpDir]);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar extract exited ${code}`))));
    });

    const metaPath = path.join(tmpDir, '_meta.json');
    if (!existsSync(metaPath)) {
      rmSync(tmpDir, { recursive: true, force: true });
      return reply.status(400).send({ error: { code: 'bad_request', message: 'Invalid archive: no _meta.json' } });
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

    try { const inst = app as unknown as { worker?: { stop: () => Promise<void> } }; if (inst.worker) await inst.worker.stop(); } catch { /* */ }

    const backupDir = path.join(config.paths.dataDir, `_backup-${Date.now()}`);

    // Restore-from-backup: if any move fails midway (e.g. a read-only cwd), put
    // the ORIGINAL files back so we never leave a moved DB with an old key
    // (which would make every secret undecryptable).
    const restoreFrom = (dir: string) => {
      // No per-file try/catch: anything that could be moved INTO the backup can
      // be moved back (same filesystem); letting an error surface here is more
      // honest than silently skipping a restore step.
      for (const name of ['ninedeploy.db', 'master.key', '.env', 'traefik']) {
        const b = path.join(dir, name);
        if (!existsSync(b)) continue;
        if (name === 'ninedeploy.db') renameSync(b, config.paths.dbFile);
        else if (name === 'master.key') renameSync(b, config.paths.masterKeyFile);
        else if (name === '.env') renameSync(b, path.join(process.cwd(), '.env'));
        else {
          // The half-imported traefik dir may occupy the target — rename(2)
          // cannot replace a non-empty directory, so clear it first (rmSync
          // with force is a no-op when the target is already gone).
          const target = path.join(config.paths.dataDir, 'traefik');
          rmSync(target, { recursive: true, force: true });
          renameSync(b, target);
        }
      }
    };

    try {
      const importedDb = path.join(tmpDir, path.relative(config.paths.dataDir, config.paths.dbFile));
      if (existsSync(importedDb)) {
        mkdirSync(backupDir, { recursive: true });
        if (existsSync(config.paths.dbFile)) renameSync(config.paths.dbFile, path.join(backupDir, 'ninedeploy.db'));
        renameSync(importedDb, config.paths.dbFile);
      }

      const importedKey = path.join(tmpDir, path.relative(config.paths.dataDir, config.paths.masterKeyFile));
      if (existsSync(importedKey)) {
        mkdirSync(backupDir, { recursive: true });
        if (existsSync(config.paths.masterKeyFile)) renameSync(config.paths.masterKeyFile, path.join(backupDir, 'master.key'));
        renameSync(importedKey, config.paths.masterKeyFile);
      }

      const importedTraefik = path.join(tmpDir, 'traefik');
      if (existsSync(importedTraefik)) {
        mkdirSync(backupDir, { recursive: true });
        const traefikDir = path.join(config.paths.dataDir, 'traefik');
        if (existsSync(traefikDir)) renameSync(traefikDir, path.join(backupDir, 'traefik'));
        renameSync(importedTraefik, traefikDir);
      }

      const importedEnv = path.join(tmpDir, '_env');
      if (existsSync(importedEnv)) {
        mkdirSync(backupDir, { recursive: true });
        const envPath = path.join(process.cwd(), '.env');
        if (existsSync(envPath)) renameSync(envPath, path.join(backupDir, '.env'));
        copyFileSync(importedEnv, envPath);
      }
    } catch (err) {
      restoreFrom(backupDir);
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }

    rmSync(tmpDir, { recursive: true, force: true });

    return {
      ok: true,
      message: 'System state imported. Restart NineDeploy for changes to take effect.',
      meta,
      backupPath: backupDir,
    };
  });
};
