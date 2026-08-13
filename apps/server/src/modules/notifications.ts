import { desc, eq } from 'drizzle-orm';
import { notificationChannels, notificationLog } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { notificationChannelCreate, notificationChannelPatch } from '@ninedeploy/schemas';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, notFound, parseId } from '../lib/errors.js';

function serialize(ch: typeof notificationChannels.$inferSelect) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type,
    hasTarget: !!ch.targetEncrypted,
    eventFilter: ch.eventFilter,
    active: ch.active,
    createdAt: ch.createdAt.toISOString(),
  };
}

/** Notification channel management. Mounted under /notifications. Admin-only. */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  // System-wide notification config — admin-only under the agreed RBAC model.
  app.addHook('preHandler', app.requireAdmin);

  // ── Channels ──────────────────────────────────────────────────────────
  app.get('/channels', async () => {
    const rows = await app.db.query.notificationChannels.findMany({ orderBy: desc(notificationChannels.id) });
    return rows.map(serialize);
  });

  app.post('/channels', async (req) => {
    const input = notificationChannelCreate.parse(req.body);

    const [ch] = await app.db
      .insert(notificationChannels)
      .values({
        name: input.name,
        type: input.type,
        targetEncrypted: encrypt(input.target),
        eventFilter: input.eventFilter ?? '',
        active: true,
      })
      .returning();
    return serialize(ch!);
  });

  app.patch('/channels/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = notificationChannelPatch.parse(req.body ?? {});
    const patch: Partial<typeof notificationChannels.$inferSelect> = {};
    if (input.eventFilter !== undefined) patch.eventFilter = input.eventFilter;
    if (input.active !== undefined) patch.active = input.active;
    const [ch] = await app.db.update(notificationChannels).set(patch).where(eq(notificationChannels.id, id)).returning();
    if (!ch) throw notFound('Channel not found');
    return serialize(ch);
  });

  app.delete('/channels/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    await app.db.delete(notificationChannels).where(eq(notificationChannels.id, id));
    return { ok: true };
  });

  // ── Test a channel ────────────────────────────────────────────────────
  app.post('/channels/:id/test', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const ch = await app.db.query.notificationChannels.findFirst({ where: eq(notificationChannels.id, id) });
    if (!ch) throw notFound('Channel not found');
    const target = decrypt(ch.targetEncrypted);
    const message = '🧪 NineDeploy test notification — your channel is working!';

    try {
      if (ch.type === 'telegram') {
        const [botToken, chatId] = target.split(':');
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message }),
        });
        if (!res.ok) throw new Error(`Telegram ${res.status}`);
      } else if (ch.type === 'webhook') {
        const res = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
        if (!res.ok) throw new Error(`Webhook ${res.status}`);
      } else if (ch.type === 'discord') {
        const res = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message }) });
        if (!res.ok) throw new Error(`Discord ${res.status}`);
      }
      return { ok: true };
    } catch (err) {
      throw badRequest(`Test failed: ${err instanceof Error ? err.message : err}`);
    }
  });

  // ── Notification log ──────────────────────────────────────────────────
  app.get('/log', async () => {
    const rows = await app.db.query.notificationLog.findMany({ orderBy: desc(notificationLog.ts), limit: 50 });
    return rows.map((l) => ({
      id: l.id,
      channelId: l.channelId,
      event: l.event,
      entity: l.entity,
      status: l.status,
      error: l.error,
      ts: l.ts.toISOString(),
    }));
  });
};
