import { eq } from 'drizzle-orm';
import { users, type DB, type User } from '@ninedeploy/db';

/**
 * Look up a user by their lowercased email address. The
 * `users.email` column is stored lowercased (a precondition enforced
 * by the email/password flow at create time) so callers can pass
 * the raw SAML attribute directly and trust the comparison.
 *
 * PR #23-b (Sprint 6) is the first caller: the SAML POST consumer
 * receives an `email` attribute from the IdP and uses this to find
 * the matching local user before minting a session. Future callers
 * (operator panel "find by email" search, audit reconciliation) can
 * share the same helper.
 */
export async function findUserByEmail(
  db: Pick<DB, 'query'>,
  email: string,
): Promise<User | undefined> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return db.query.users.findFirst({ where: eq(users.email, normalized) });
}
