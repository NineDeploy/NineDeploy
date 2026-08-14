import { eq } from 'drizzle-orm';
import { settings, type DB } from '@ninedeploy/db';

/**
 * Read a settings-table value with a fallback. Values are stored as JSON
 * (the column is json-mode text), so booleans arrive as real booleans.
 */
export async function getSetting(db: DB, key: string, fallback: boolean): Promise<boolean> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  const value = row?.value;
  return typeof value === 'boolean' ? value : fallback;
}

/** Upsert a boolean setting (primary-key upsert on `key`). */
export async function setSetting(db: DB, key: string, value: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
