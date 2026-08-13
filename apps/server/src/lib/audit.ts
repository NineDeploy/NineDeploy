import { auditLog, type DB } from '@ninedeploy/db';

/** Write an audit-log entry (best-effort, never throws). */
export async function audit(
  db: DB,
  userId: number | null,
  action: string,
  entity?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLog).values({ userId, action, entity, meta });
  } catch {
    /* audit logging must never break the request */
  }
}
