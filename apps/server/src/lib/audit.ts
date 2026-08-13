import { auditLog, type DB } from '@ninedeploy/db';
import { eventBus } from './events.js';
import { notifyEvent } from './notifier.js';

/** Write an audit-log entry and emit a real-time event (best-effort, never throws). */
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
  const event = { id: 0, action, entity: entity ?? null, ts: new Date().toISOString() };
  eventBus.publish(action, entity);
  // Fire-and-forget notification dispatch
  void notifyEvent(db, event).catch(() => undefined);
}
