import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { config } from './config.js';
import rateLimitPlugin from './plugins/rateLimit.js';

/**
 * The agent's minimal HTTP surface: rate limiting plus (once the caller
 * registers `agentRoutes`) ONLY the token-gated /agent/exec and /agent/ping
 * routes. Deliberately NOT buildApp(): an agent host must never expose the
 * API/dashboard/deploy worker, which would run against a fresh local SQLite
 * and turn any reachable agent into a full control plane.
 */
export async function buildAgentApp() {
  const app = Fastify({
    // Same reasoning as buildApp(): the agent may sit behind the panel's
    // Traefik (agent enrolment routes are proxied), so trust the configured
    // hop count for rate-limit keying.
    trustProxy: config.trustProxy,
    logger: {
      // Same rule as the master app: never persist query strings.
      serializers: {
        req(req: { method?: string; url: string; remoteAddress?: string; hostname?: string }) {
          const url = req.url.split('?')[0]!;
          return { method: req.method, url, remoteAddress: req.remoteAddress, hostname: req.hostname };
        },
      },
    },
  });

  await app.register(rateLimitPlugin);

  app.setErrorHandler((err: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) app.log.error({ err }, 'agent request error');
    return reply.status(status).send({
      error: {
        code: err.code ?? 'internal_error',
        message: status >= 500 && config.isProd ? 'Internal server error' : err.message,
      },
    });
  });

  return app;
}
