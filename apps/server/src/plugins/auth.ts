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
    /**
     * Per-route fine-grained scope check (G-08). A route can
     * declare `config: { scope: 'write:services' }` (legacy
     * shorthand) or `config: { scope: 'nd://scope/write/services' }`
     * (resource-scoped) and this pre-handler will refuse the
     * request when the bearer token's stored scopes do not
     * cover it. Operator scope and the legacy `write`
     * shorthand cover any fine-grained scope; an interactive
     * session (JWT) is always treated as fully covered.
     */
    requireScope: (
      scope: string,
    ) => (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
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

    // Per-route fine-grained scope check (G-08). The factory
    // closes over the required scope; the pre-handler reads
    // the bearer token's stored scopes (already on
    // `req.user.tokenScopes` from the authenticate hook) and
    // refuses when they don't cover the requirement.
    fastify.decorate('requireScope', (scope) => async (req) => {
      if (!req.user) throw unauthorized();
      if (!scopeCovers(req.user, scope)) throw forbidden(`This token is missing the required scope: ${scope}`);
    });
  },
  { name: 'ninedeploy-auth' },
);

/**
 * Decide whether `user`'s token scopes cover the
 * `required` scope. The rule:
 *   - `null` scopes (interactive JWT or legacy token) cover
 *     every fine-grained scope.
 *   - The legacy `operator` scope covers every scope.
 *   - The legacy `write` scope covers every fine-grained
 *     `nd://scope/write/<resource>` AND
 *     `nd://scope/admin/<resource>` (admin implies write).
 *   - The legacy `read` scope covers every fine-grained
 *     `nd://scope/read/<resource>`.
 *   - Otherwise exact match on the URI form.
 */
function scopeCovers(user: AuthUser, required: string): boolean {
  const scopes = user.tokenScopes;
  if (scopes === null) return true;
  if (scopes.includes('operator')) return true;
  if (scopes.includes(required)) return true;
  // Match the legacy coarse scopes against a fine-grained
  // URI requirement.
  if (required.startsWith('nd://scope/admin/') || required.startsWith('nd://scope/write/')) {
    if (scopes.includes('write') || scopes.includes('admin')) return true;
  }
  if (required.startsWith('nd://scope/read/')) {
    if (scopes.includes('read')) return true;
  }
  // `nd://scope/admin/X` is a strict superset of
  // `nd://scope/write/X` and `nd://scope/read/X`; the
  // resource-scope form does NOT cross resources (an
  // admin scope on `services` does not cover `databases`).
  if (required.startsWith('nd://scope/write/')) {
    const resource = required.slice('nd://scope/write/'.length);
    if (scopes.includes(`nd://scope/admin/${resource}`)) return true;
  }
  if (required.startsWith('nd://scope/read/')) {
    const resource = required.slice('nd://scope/read/'.length);
    if (scopes.includes(`nd://scope/write/${resource}`)) return true;
    if (scopes.includes(`nd://scope/admin/${resource}`)) return true;
  }
  return false;
}
