import type { FastifyPluginAsync } from 'fastify';
import { containerFileWrite, containerPathCreate } from '@ninedeploy/schemas';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import {
  deleteContainerPath,
  getContainerComposeManifest,
  inspectContainer,
  isManagedContainer,
  listContainerDir,
  makeContainerDir,
  readContainerFile,
  safeContainerPath,
  writeContainerFile,
} from '../engine/containerFiles.js';

export const containerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  const guardContainer = (container: string): string => {
    if (!isManagedContainer(container)) throw badRequest('invalid container');
    return container;
  };

  const guardPath = (raw: unknown): string => {
    const safe = safeContainerPath(String(raw ?? '/'));
    if (safe === null) throw badRequest('invalid path');
    return safe;
  };

  // ── Get detailed inspect metadata and Traefik tags ────────────────────────
  // Admin-only: the inspect payload includes the container's full env (injected
  // DATABASE_URL/REDIS_URL credentials) — same power as the exec terminal.
  app.get('/:container/inspect', { preHandler: [app.requireAdmin] }, async (req) => {
    const container = guardContainer((req.params as { container: string }).container);
    return inspectContainer(container);
  });

  // ── Get runtime generated Docker Compose YAML manifest ───────────────────
  // Admin-only: the manifest renders every env var of the container.
  app.get('/:container/compose', { preHandler: [app.requireAdmin] }, async (req) => {
    const container = guardContainer((req.params as { container: string }).container);
    return getContainerComposeManifest(container);
  });

  // ── List directory contents inside container ──────────────────────────────
  app.get('/:container/files', { preHandler: [app.requireAdmin] }, async (req) => {
    const container = guardContainer((req.params as { container: string }).container);
    const target = guardPath((req.query as { path?: string }).path);
    const entries = await listContainerDir(container, target);
    return { path: target, entries };
  });

  // ── Read file content (base64) ───────────────────────────────────────────
  app.get('/:container/files/content', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const container = guardContainer((req.params as { container: string }).container);
    const target = guardPath((req.query as { path?: string }).path);
    if (target === '/') throw badRequest('invalid file path');
    void audit(app.db, req.user!.id, 'container.file.read', `${container}:${target}`);
    const file = await readContainerFile(container, target);
    reply.header('content-type', 'application/json');
    return file;
  });

  // ── Write / overwrite file (base64) ──────────────────────────────────────
  app.put('/:container/files', { preHandler: [app.requireAdmin] }, async (req) => {
    const container = guardContainer((req.params as { container: string }).container);
    const input = containerFileWrite.parse(req.body);
    const target = guardPath(input.path);
    if (target === '/') throw badRequest('invalid file path');
    void audit(app.db, req.user!.id, 'container.file.write', `${container}:${target}`);
    await writeContainerFile(container, target, input.contentBase64, (line) => req.log.info(line));
    return { ok: true };
  });

  // ── Create directory (mkdir -p) ──────────────────────────────────────────
  app.post('/:container/files/dir', { preHandler: [app.requireAdmin] }, async (req) => {
    const container = guardContainer((req.params as { container: string }).container);
    const input = containerPathCreate.parse(req.body);
    const target = guardPath(input.path);
    if (target === '/') throw badRequest('invalid directory path');
    void audit(app.db, req.user!.id, 'container.file.mkdir', `${container}:${target}`);
    await makeContainerDir(container, target);
    return { ok: true };
  });

  // ── Delete file or directory (rm -rf) ────────────────────────────────────
  app.delete('/:container/files', { preHandler: [app.requireAdmin] }, async (req) => {
    const container = guardContainer((req.params as { container: string }).container);
    const target = guardPath((req.query as { path?: string }).path);
    if (target === '/') throw badRequest('cannot delete root directory');
    void audit(app.db, req.user!.id, 'container.file.delete', `${container}:${target}`);
    await deleteContainerPath(container, target, (line) => req.log.info(line));
    return { ok: true };
  });
};
