import { eq } from 'drizzle-orm';
import { databases, envVars, notificationChannels, sources, tunnels, webhooks, type DB } from '@ninedeploy/db';
import { reencrypt } from './crypto.js';

/**
 * Re-encrypt every stored secret with the ACTIVE master-key version.
 *
 * Rotation procedure:
 *   1. Generate a new 32-byte key and add it to NINEDEPLOY_MASTER_KEYS under a
 *      higher version than the current one (e.g. `0:<old>,1:<new>`).
 *   2. Restart the server (it now encrypts new secrets with the new key but can
 *      still decrypt old ones).
 *   3. Call rotateSecrets(db) to migrate every existing secret onto the new key.
 *   4. Remove the old key version from NINEDEPLOY_MASTER_KEYS and restart again.
 *
 * Returns the number of rows re-encrypted.
 */
export async function rotateSecrets(db: DB): Promise<number> {
  let count = 0;
  const re = (v: string | null): string | null => (v === null ? null : reencrypt(v));

  const single = async <T extends { id: number }>(
    table: Parameters<DB['update']>[0],
    rows: T[],
    pick: (r: T) => Record<string, unknown>,
  ) => {
    for (const r of rows) {
      await db.update(table).set(pick(r)).where(eq((table as unknown as { id: never }).id, r.id));
      count++;
    }
  };

  await single(
    envVars,
    await db.select({ id: envVars.id, v: envVars.valueEncrypted }).from(envVars),
    (r) => ({ valueEncrypted: reencrypt(r.v) }),
  );
  await single(
    webhooks,
    await db.select({ id: webhooks.id, v: webhooks.secretEncrypted }).from(webhooks),
    (r) => ({ secretEncrypted: reencrypt(r.v) }),
  );
  await single(
    databases,
    await db.select({ id: databases.id, v: databases.passwordEncrypted }).from(databases),
    (r) => ({ passwordEncrypted: reencrypt(r.v) }),
  );
  await single(
    tunnels,
    await db.select({ id: tunnels.id, v: tunnels.tokenEncrypted }).from(tunnels),
    (r) => ({ tokenEncrypted: reencrypt(r.v) }),
  );
  await single(
    notificationChannels,
    await db.select({ id: notificationChannels.id, v: notificationChannels.targetEncrypted }).from(notificationChannels),
    (r) => ({ targetEncrypted: reencrypt(r.v) }),
  );
  // sources has two independent nullable credential columns.
  await single(
    sources,
    await db.select({ id: sources.id, t: sources.tokenEncrypted, k: sources.deployKeyEncrypted }).from(sources),
    (r) => ({ tokenEncrypted: re(r.t), deployKeyEncrypted: re(r.k) }),
  );

  return count;
}
