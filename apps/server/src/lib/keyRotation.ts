import { eq } from 'drizzle-orm';
import {
  backupDestinations,
  backups,
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
import { activeKeyVersion, reencrypt } from './crypto.js';

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
 *   4. Remove the old key version from NINEDEPLOY_MASTER_KEYS and restart again
 *      — but see the warning below first.
 *
 * **Step 4 is not safe while old backups matter.** This function rewrites the
 * encrypted COLUMNS listed above and nothing else. Database and volume dumps on
 * disk (and in S3) are sealed by `createBackupCipher` under a `NDBK1:v<version>`
 * header, and `createBackupDecipher` throws when that version is not in the
 * ring. Dropping the retired key therefore makes every backup taken under it
 * permanently unrestorable. Keep the old version in `NINEDEPLOY_MASTER_KEYS`
 * until those backups have aged out of retention; `rotateSecrets` reports the
 * count so the caller can say so.
 *
 * Re-running is safe (idempotent — `reencrypt` is a no-op for values already on
 * the active version).
 */
export interface RotationResult {
  /** Encrypted column values moved onto the active key. */
  rotated: number;
  /** The key version everything is now sealed under. */
  activeVersion: number;
  /**
   * Backup rows that exist on disk. Their envelopes are NOT rewritten by this
   * routine — the caller warns the operator not to retire the old key while
   * any of them are still needed.
   */
  backupsNotRotated: number;
}

/**
 * Rotate every encrypted column onto the active key and report what happened.
 * Thin wrapper over `rotateSecrets` so the route/CLI have one honest answer to
 * render rather than a bare number.
 */
export async function rotateSecretsWithReport(db: DB): Promise<RotationResult> {
  const rotated = await rotateSecrets(db);
  let backupsNotRotated = 0;
  try {
    backupsNotRotated = (await db.select({ id: backups.id }).from(backups)).length;
  } catch {
    // The table may not exist on a very old database; a missing count must not
    // fail a rotation that already succeeded.
  }
  return { rotated, activeVersion: activeKeyVersion(), backupsNotRotated };
}

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
