import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { ABOUT } from './version.js';
import { apiRoutes } from './modules/api.js';
import { eventRoutes } from './modules/events.js';
import { healthRoutes } from './modules/health.js';
import authPlugin from './plugins/auth.js';
import backupSchedulerPlugin from './plugins/backupScheduler.js';
import collectorPlugin from './plugins/collector.js';
import dbPlugin from './plugins/db.js';
import housekeepingPlugin from './plugins/housekeeping.js';
import jobSchedulerPlugin from './plugins/jobScheduler.js';
import kernelPlugin from './plugins/kernel.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import rawBodyPlugin from './plugins/rawBody.js';
import staticFilesPlugin from './plugins/staticFiles.js';
import traefikPlugin from './plugins/traefik.js';
import workerPlugin from './plugins/worker.js';

/** Translate thrown ZodErrors into a consistent 400 envelope. */
function formatZodError(error: ZodError) {
  return {
    error: {
      code: 'validation_error',
      message: 'Request validation failed',
      details: error.flatten(),
    },
  };
}

/** Build a Fastify instance — exported so tests can spin up an isolated app. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Never persist query strings: WebSocket auth passes the bearer token in
      // ?token=…, and the default req serializer logs the full URL at info level.
      serializers: {
        req(req: { method?: string; url: string; remoteAddress?: string; hostname?: string }) {
          const url = req.url.split('?')[0]!;
          return { method: req.method, url, remoteAddress: req.remoteAddress, hostname: req.hostname };
        },
      },
    },
    // System import uploads a full backup tarball (SQLite + Traefik config);
    // the default 1 MB cap would reject every real backup.
    bodyLimit: 256 * 1024 * 1024,
  });

  // Restrict CORS to a known allowlist instead of reflecting any origin
  // (`origin: true`). The dashboard is same-origin in production; the extra
  // entries cover local dev (Vite :5173) and additional origins via env.
  const extraOrigins = (process.env['NINEDEPLOY_CORS_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOrigins = [
    ...new Set([config.publicUrl, 'http://localhost:5173', 'http://localhost:3000', ...extraOrigins]),
  ];
  await app.register(cors, { origin: allowedOrigins, credentials: true });
  await app.register(websocket);
  await app.register(rateLimitPlugin);
  await app.register(rawBodyPlugin);
  await app.register(dbPlugin);
  await app.register(kernelPlugin);
  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send(formatZodError(err));
    }
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) app.log.error({ err }, 'request error');
    return reply.status(status).send({
      error: {
        code: err.code ?? 'internal_error',
        message: status >= 500 && config.isProd ? 'Internal server error' : err.message,
      },
    });
  });

  // Public
  await app.register(healthRoutes);
  await app.register(eventRoutes);
  // Versioned API
  await app.register(apiRoutes, { prefix: '/v1' });
  // Background deploy worker
  await app.register(workerPlugin);
  // Traefik reverse proxy + dynamic routing
  await app.register(traefikPlugin);
  // Resource metrics collector
  await app.register(collectorPlugin);
  // Scheduled database backups
  await app.register(backupSchedulerPlugin);
  // Periodic log/audit/notification-log retention (disk-fill prevention)
  await app.register(housekeepingPlugin);
  await app.register(jobSchedulerPlugin);

  // Web dashboard (SPA) — registered LAST so every API/WS route wins over the
  // catch-all; unknown API paths still get JSON 404s via the SPA fallback guard.
  await app.register(staticFilesPlugin);

  // About info
  void ABOUT;

  return app;
}
