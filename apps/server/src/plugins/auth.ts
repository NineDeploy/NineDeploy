import { eq } from 'drizzle-orm';
import { apiTokens } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { resolveUser } from '../lib/auth.js';
import { sha256 } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthUser {
  id: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Pre-handler that verifies a Bearer token (JWT access or API token). */
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/**
 * Authentication strategy: the `Authorization: Bearer <token>` header may hold
 * either a signed JWT access token (web/CLI sessions) or an opaque API token
 * (CI/scripts). Both resolve to `req.user.id`.
 */
export default fp(
  async (fastify) => {
    fastify.decorateRequest('user', null);
    fastify.decorate('authenticate', async (req) => {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      const token = header.slice('Bearer '.length).trim();
      const user = await resolveUser(fastify.db, token);
      if (!user) throw unauthorized();
      req.user = user;

      // Stamp API-token last-used time (best effort; JWTs have no DB row).
      if (token.split('.').length !== 3) {
        await fastify.db
          .update(apiTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiTokens.hash, sha256(token)));
      }
    });
  },
  { name: 'ninedeploy-auth' },
);
