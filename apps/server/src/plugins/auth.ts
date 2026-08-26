import { eq } from 'drizzle-orm';
import { apiTokens } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { resolveUser } from '../lib/auth.js';
import { sha256 } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { assertOperator } from '../lib/resourceAccess.js';

export interface AuthUser {
  id: number;
  /**
   * True when the user holds owner/admin in at least one workspace — replaces
   * the legacy global `role === 'admin'` check. Recomputed on every request
   * so a role change takes effect immediately.
   */
  isOperator: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Pre-handler that verifies a Bearer token (JWT access or API token). */
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    /** Pre-handler that requires the authenticated user to be an operator
     *  (owner/admin in at least one workspace). Run after `authenticate`. */
    requireOperator: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    /**
     * Legacy alias for `requireOperator`. After the team overhaul, "admin"
     * no longer means a global `users.role` value; both names now resolve to
     * the same operator check. Existing call sites keep working unchanged.
     */
    requireAdmin: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/**
 * Authentication strategy: the `Authorization: Bearer <token>` header may hold
 * either a signed JWT access token (web/CLI sessions) or an opaque API token
 * (CI/scripts). Both resolve to `req.user.id` and a freshly-computed
 * `req.user.isOperator` flag.
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

    fastify.decorate('requireOperator', async (req) => {
      // `authenticate` is expected to run first (as an onRequest hook). A
      // missing/non-operator user is forbidden — destructive, system-wide
      // actions are operator-only under the agreed RBAC model.
      if (!req.user) throw unauthorized();
      await assertOperator(fastify.db, req.user);
      if (!req.user.isOperator) throw forbidden('Operator access required');
    });

    // Back-compat alias — see the JSDoc on the FastifyInstance augmentation.
    fastify.decorate('requireAdmin', async (req) => {
      if (!req.user) throw unauthorized();
      await assertOperator(fastify.db, req.user);
      if (!req.user.isOperator) throw forbidden('Admin access required');
    });
  },
  { name: 'ninedeploy-auth' },
);
