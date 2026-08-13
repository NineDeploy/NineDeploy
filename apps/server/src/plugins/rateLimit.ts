import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';

/**
 * Global IP-based rate limiting. The per-route overrides on auth/webhook routes
 * (see `config.rateLimit` on those handlers) apply tighter ceilings to the
 * brute-force / credential-stuffing surfaces. Defaults are deliberately generous
 * so a legitimate single-server workload is never throttled.
 */
export default fp(
  async (fastify) => {
    await fastify.register(rateLimit, {
      global: true,
      max: 1000,
      timeWindow: '1 minute',
      // Don't leak rate-limit headers (reduces fingerprinting / probing surface).
      addHeadersOnExceeding: { 'x-ratelimit-remaining': false, 'x-ratelimit-limit': false },
      addHeaders: { 'x-ratelimit-remaining': false, 'x-ratelimit-limit': false, 'retry-after': true },
    });
  },
  { name: 'ninedeploy-rate-limit' },
);
