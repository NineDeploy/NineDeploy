import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { apiRoutes } from './modules/api.js';
import { healthRoutes } from './modules/health.js';
import authPlugin from './plugins/auth.js';
import collectorPlugin from './plugins/collector.js';
import dbPlugin from './plugins/db.js';
import rawBodyPlugin from './plugins/rawBody.js';
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
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);
  await app.register(rawBodyPlugin);
  await app.register(dbPlugin);
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
  // Versioned API
  await app.register(apiRoutes, { prefix: '/v1' });
  // Background deploy worker
  await app.register(workerPlugin);
  // Traefik reverse proxy + dynamic routing
  await app.register(traefikPlugin);
  // Resource metrics collector
  await app.register(collectorPlugin);

  return app;
}
