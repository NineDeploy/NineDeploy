import { eq } from 'drizzle-orm';
import { apiTokens } from '@ninedeploy/db';
import fp from 'fastify-plugin';
import { resolveUser } from '../lib/auth.js';
import { sha256 } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AuthUser {
  id: number;
  /**
   * True when `users.is_instance_operator` is set. Recomputed on every request
   * so granting or revoking it takes effect immediately. Deliberately not
   * derived from workspace roles — see `lib/resourceAccess.ts:isOperator`.
   *
   * A scope-restricted API token can only ever narrow this, never widen it.
   */
  isOperator: boolean;
  /**
   * Scopes of the API token used for this request, or `null` for an
   * interactive session (JWT) and for legacy tokens created before scopes
   * were enforced. `null` means unrestricted.
   */
  tokenScopes: string[] | null;
}

/** Methods that cannot change server state. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyInstance {
    /** Pre-handler that verifies a Bearer token (JWT access or API token). */
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    /** Pre-handler that requires the authenticated user to carry the
     *  instance-operator flag. Run after `authenticate`. */
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

      // Apply API-token scopes. This is the single enforcement point: doing it
      // here (rather than annotating every route) means a new endpoint is
      // covered the day it is added, and it cannot be forgotten.
      //
      // Before 0.3.5 the `scopes` column was written as `[]` and never read, so
      // every token — including the ones handed to CI and to the MCP server —
      // carried its owner's full authority, operator flag included.
      if (user.tokenScopes !== null) {
        const scopes = user.tokenScopes;
        // Only an explicit `operator` scope may act as an operator. A `write`
        // token owned by an operator still runs as a normal user, which is what
        // keeps a leaked CI token away from PM2/compose/host hooks.
        if (!scopes.includes('operator')) user.isOperator = false;
        const mayWrite = scopes.includes('write') || scopes.includes('operator');
        if (!mayWrite && !SAFE_METHODS.has(req.method)) {
          throw forbidden('This API token is read-only');
        }
      }
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
      // `authenticate` is expected to run first (as an onRequest hook), and it
      // has already resolved `isOperator` from `users.is_instance_operator` AND
      // narrowed it for scope-restricted API tokens. Re-querying the DB here
      // would undo that narrowing, so the flag on the request is authoritative.
      if (!req.user) throw unauthorized();
      if (!req.user.isOperator) throw forbidden('Operator access required');
    });

    // Back-compat alias — see the JSDoc on the FastifyInstance augmentation.
    fastify.decorate('requireAdmin', async (req) => {
      if (!req.user) throw unauthorized();
      if (!req.user.isOperator) throw forbidden('Admin access required');
    });
  },
  { name: 'ninedeploy-auth' },
);
