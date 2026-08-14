import { type DB, notificationLog } from '@ninedeploy/db';
import { decrypt } from './crypto.js';
import type { AppEvent } from './events.js';
import { encrypt } from './crypto.js';

/** Check if an event matches a channel's filter (comma-separated prefixes). */
function matchesFilter(eventAction: string, filter: string): boolean {
  if (!filter.trim()) return true; // empty = all events
  return filter.split(',').map((f) => f.trim()).some((prefix) => eventAction.startsWith(prefix));
}

/** Escape HTML special chars so user-controlled entities can't break Telegram's HTML parse mode. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Format an event into a human-readable message. */
function formatMessage(action: string, entity?: string | null): string {
  const parts = action.split('.');
  const verb = parts[1] ?? parts[0]!;
  const subject = parts[0]!;
  const emoji: Record<string, string> = {
    service: '🖥️', database: '🗄️', domain: '🌐', deploy: '🚀', backup: '💾',
    tunnel: '☁️', user: '👤', template: '✨', source: '🔑',
  };
  const icon = emoji[subject] ?? '•';
  // The entity (service/user names) is user-controlled — escape it so the
  // Telegram HTML parse mode can't be broken (<b>, malformed tags → 400).
  return `${icon} ${subject} ${verb}${entity ? `: ${escapeHtml(entity)}` : ''}`;
}

/** A slow notification target must not stall its channel's dispatch. */
const FETCH_TIMEOUT_MS = 10_000;

/** Send to a Telegram bot chat. */
async function sendTelegram(botToken: string, chatId: string, message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Telegram API ${res.status}: ${await res.text()}`);
}

/** Send to a generic webhook (POST JSON). */
async function sendWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
}

/** Send to a Discord webhook. */
async function sendDiscord(webhookUrl: string, message: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
}

/**
 * Process an event through all active notification channels.
 * Telegram target format: `botToken:chatId`
 * Webhook target format: URL
 * Discord target format: webhook URL
 */
export async function notifyEvent(db: DB, event: AppEvent): Promise<void> {
  let channels;
  try {
    channels = await db.query.notificationChannels.findMany();
  } catch {
    return; // table might not exist yet
  }

  for (const ch of channels) {
    if (!ch.active) continue;
    if (!matchesFilter(event.action, ch.eventFilter)) continue;

    const message = formatMessage(event.action, event.entity);
    const target = decrypt(ch.targetEncrypted);

    try {
      if (ch.type === 'telegram') {
        const [botToken, chatId] = target.split(':');
        if (!botToken || !chatId) throw new Error('Invalid Telegram target (expected botToken:chatId)');
        await sendTelegram(botToken, chatId, message);
      } else if (ch.type === 'webhook') {
        await sendWebhook(target, { event: event.action, entity: event.entity, ts: event.ts, message });
      } else if (ch.type === 'discord') {
        await sendDiscord(target, message);
      }
      await db.insert(notificationLog).values({ channelId: ch.id, event: event.action, entity: event.entity, status: 'sent' });
    } catch (err) {
      await db.insert(notificationLog).values({
        channelId: ch.id,
        event: event.action,
        entity: event.entity,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Re-export encrypt for the notifications module
export { encrypt };
