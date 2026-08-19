import { eq } from 'drizzle-orm';
import {
  backupDestinations,
  databases,
  envVars,
  logDrains,
  notificationChannels,
  oidcProviders,
  servers,
  sources,
  tunnels,
  users,
  webhooks,
  type DB,
} from '@ninedeploy/db';
import { reencrypt } from './crypto.js';

/**
 * Single registry of every encrypted column in the schema. `rotateSecrets`
 * walks it, so adding a new encrypted column is a one-line change here —
 * forgetting it silently leaves that secret on the retired key forever.
 *
 * Each entry selects the row id + the encrypted value(s) from the table, and
 * maps them back onto the column name(s) for the UPDATE. `re` keeps nulls
 * (nullable columns) as-is so they are never passed through `reencrypt`.
 */
const ENCRYPTED_COLUMNS = [
  {
    table: envVars,
    select: { id: envVars.id, v: envVars.valueEncrypted },
    pick: (r: { id: number; v: string }) => ({ valueEncrypted: reencrypt(r.v) }),
  },
  {
    table: webhooks,
    select: { id: webhooks.id, v: webhooks.secretEncrypted },
    pick: (r: { id: number; v: string }) => ({ secretEncrypted: reencrypt(r.v) }),
  },
  {
    table: databases,
    select: { id: databases.id, v: databases.passwordEncrypted },
    pick: (r: { id: number; v: string }) => ({ passwordEncrypted: reencrypt(r.v) }),
  },
  {
    table: tunnels,
    select: { id: tunnels.id, v: tunnels.tokenEncrypted },
    pick: (r: { id: number; v: string }) => ({ tokenEncrypted: reencrypt(r.v) }),
  },
  {
    table: notificationChannels,
    select: { id: notificationChannels.id, v: notificationChannels.targetEncrypted },
    pick: (r: { id: number; v: string }) => ({ targetEncrypted: reencrypt(r.v) }),
  },
  // sources has two independent nullable credential columns.
  {
    table: sources,
    select: { id: sources.id, t: sources.tokenEncrypted, k: sources.deployKeyEncrypted },
    pick: (r: { id: number; t: string | null; k: string | null }) => ({
      tokenEncrypted: r.t === null ? null : reencrypt(r.t),
      deployKeyEncrypted: r.k === null ? null : reencrypt(r.k),
    }),
  },
  {
    table: users,
    select: { id: users.id, v: users.totpSecretEncrypted },
    pick: (r: { id: number; v: string | null }) => ({ totpSecretEncrypted: r.v === null ? null : reencrypt(r.v) }),
  },
  {
    table: oidcProviders,
    select: { id: oidcProviders.id, v: oidcProviders.clientSecretEncrypted },
    pick: (r: { id: number; v: string }) => ({ clientSecretEncrypted: reencrypt(r.v) }),
  },
  {
    table: backupDestinations,
    select: { id: backupDestinations.id, v: backupDestinations.secretKeyEncrypted },
    pick: (r: { id: number; v: string }) => ({ secretKeyEncrypted: reencrypt(r.v) }),
  },
  {
    table: servers,
    select: { id: servers.id, v: servers.tokenEncrypted },
    pick: (r: { id: number; v: string }) => ({ tokenEncrypted: reencrypt(r.v) }),
  },
  {
    table: logDrains,
    select: { id: logDrains.id, v: logDrains.apiKeyEncrypted },
    pick: (r: { id: number; v: string | null }) => ({ apiKeyEncrypted: r.v === null ? null : reencrypt(r.v) }),
  },
] as const;

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
 * Returns the number of rows re-encrypted. Re-running is safe (idempotent —
 * `reencrypt` is a no-op for values already on the active version).
 */
export async function rotateSecrets(db: DB): Promise<number> {
  let count = 0;

  for (const entry of ENCRYPTED_COLUMNS) {
    const rows = (await db.select(entry.select).from(entry.table)) as Array<Record<string, string | number | null>>;
    for (const row of rows) {
      const id = row['id'];
      if (typeof id !== 'number') continue;
      await db
        .update(entry.table)
        // @ts-expect-error — drizzle's update types are not tuple-shaped for a
        // generic pick; the registry itself is the schema-drift guard.
        .set(entry.pick(row as never))
        .where(eq(entry.table.id, id));
      count++;
    }
  }

  return count;
}
