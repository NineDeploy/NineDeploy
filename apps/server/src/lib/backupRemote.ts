import { eq } from 'drizzle-orm';
import { backups, type BackupDestination, type DB } from '@ninedeploy/db';
import { decrypt } from './crypto.js';
import { s3Delete, s3Get, s3Put, type S3Config } from './s3.js';

/** Resolve the first active destination into an S3 client config (or null). */
export async function activeDestination(db: DB): Promise<(S3Config & { prefix: string }) | null> {
  let row: BackupDestination | undefined;
  try {
    row = (await db.query.backupDestinations.findMany()).find((d) => d.active);
  } catch {
    return null; // table might not exist yet
  }
  if (!row) return null;
  return {
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    prefix: row.prefix,
    accessKeyId: row.accessKeyId,
    secretAccessKey: decrypt(row.secretKeyEncrypted),
  };
}

/**
 * Upload a completed backup's ENCRYPTED envelope to the active destination and
 * stamp `remoteKey` on the row. Best-effort: an upload failure is logged via
 * the callback but never fails the backup itself (the local copy remains).
 */
export async function uploadBackup(
  db: DB,
  backupId: number,
  localPath: string,
  log: (line: string) => void,
): Promise<void> {
  const dest = await activeDestination(db);
  if (!dest) return;
  const { prefix, ...cfg } = dest;
  const key = `${prefix.replace(/\/$/, '')}/${localPath.split('/').pop()}`.replace(/^\/+/, '');
  try {
    // readBackupBytes gives the PLAINTEXT; we re-upload the on-disk encrypted
    // envelope so a stolen bucket alone can't leak database contents.
    const { readFileSync } = await import('node:fs');
    await s3Put(cfg, key, readFileSync(localPath));
    await db.update(backups).set({ remoteKey: key }).where(eq(backups.id, backupId));
    log(`☁ Uploaded to ${dest.bucket}/${key}`);
  } catch (err) {
    log(`warning: remote upload failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Fetch a remote-only backup to a local path (returns the path to use). */
export async function fetchRemoteBackup(
  db: DB,
  remoteKey: string,
  localPath: string,
): Promise<string> {
  const dest = await activeDestination(db);
  if (!dest) throw new Error('No backup destination configured');
  const { prefix, ...cfg } = dest;
  const bytes = await s3Get(cfg, remoteKey);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(localPath, bytes, { mode: 0o600 });
  return localPath;
}

/** Delete the remote object for a backup row (missing objects are fine). */
export async function deleteRemoteBackup(db: DB, remoteKey: string | null): Promise<void> {
  if (!remoteKey) return;
  const dest = await activeDestination(db);
  if (!dest) return;
  const { prefix: _p, ...cfg } = dest;
  await s3Delete(cfg, remoteKey).catch(() => undefined);
}
