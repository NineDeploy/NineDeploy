import { type DB, notificationLog, type NotificationChannel } from '@ninedeploy/db';
import { decrypt } from './crypto.js';
import type { AppEvent } from './events.js';
import { encrypt } from './crypto.js';
import { guardedFetch } from './egressGuard.js';

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
    tunnel: '☁️', user: '👤', template: '✨', source: '🔑', alert: '🔔',
  };
  const icon = emoji[subject] ?? '•';
  // The entity (service/user names) is user-controlled — escape it so the
  // Telegram HTML parse mode can't be broken (<b>, malformed tags → 400).
  return `${icon} ${subject} ${verb}${entity ? `: ${escapeHtml(entity)}` : ''}`;
}

/** A slow notification target must not stall its channel's dispatch. */
const FETCH_TIMEOUT_MS = 10_000;

/** Backoff delays between delivery retries (attempt 1 → wait 500ms → attempt 2 → wait 2s → attempt 3). */
export const RETRY_DELAYS_MS = [500, 2000];

/** Run an async send with up to RETRY_DELAYS_MS.length retries; returns the attempt count. */
export async function withRetry(fn: () => Promise<void>, delays: number[] = RETRY_DELAYS_MS): Promise<number> {
  let attempt = 1;
  for (;;) {
    try {
      await fn();
      return attempt;
    } catch (err) {
      const delay = delays[attempt - 1];
      if (delay === undefined) throw err;
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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
  const res = await guardedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
}

/** Public shape of a Discord channel's `config_json` blob (Sprint 5 G-18 PR #24). */
export interface DiscordChannelConfig {
  /** Override the webhook's display name. */
  username?: string;
  /** Override the webhook's avatar (must be a Discord-hosted https URL). */
  avatarUrl?: string;
  /** When set, a coloured embed is appended with this title. */
  title?: string;
  /** Embed sidebar colour (24-bit RGB). Defaults to blue when `title` is set. */
  color?: number;
}

/** Send to a Discord webhook (Sprint 5 G-18 PR #24).
 *
 *  Uses Discord's `embeds` shape so the operator's webhook lights
 *  up with a coloured sidebar and structured fields, not just a
 *  plain text line. The shape is the same one Discord's own
 *  webhook editor produces; an operator who pastes the same URL
 *  into Discord's UI gets a richer preview than our plain
 *  `content` payload.
 *
 *  If a custom username / avatar is configured in the channel's
 *  `config_json` we forward it too; otherwise Discord uses the
 *  webhook's default identity.
 *
 *  Exported for tests; production code reaches it via
 *  `dispatchChannel(..., { configJson: ch.configJson })`.
 */
export async function sendDiscord(
  webhookUrl: string,
  message: string,
  options?: DiscordChannelConfig,
): Promise<void> {
  const body: Record<string, unknown> = { content: message };
  if (options?.username || options?.avatarUrl) {
    if (options.username) body.username = options.username;
    if (options.avatarUrl) body.avatar_url = options.avatarUrl;
  }
  // An optional embed with a coloured sidebar. Operators opt in by
  // setting `title` in the channel config; the default skips the
  // embed so a plain `content` line stays clean.
  if (options?.title) {
    body.embeds = [
      {
        title: options.title,
        description: message,
        color: typeof options.color === 'number' ? options.color : 0x2563eb,
      },
    ];
  }
  const res = await guardedFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
}

/** Send to a Slack incoming webhook. */
async function sendSlack(webhookUrl: string, message: string): Promise<void> {
  const res = await guardedFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}`);
}

/** Publish to an ntfy topic (target = topic URL, e.g. https://ntfy.sh/my-topic). */
async function sendNtfy(topicUrl: string, message: string): Promise<void> {
  const res = await guardedFetch(topicUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: message,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

export interface EmailTarget {
  host: string;
  port: number;
  from: string;
  to: string;
  user?: string;
  pass?: string;
  secure?: boolean;
}

/** Parse (and validate the shape of) an email channel target. */
export function parseEmailTarget(target: string): EmailTarget {
  let parsed: unknown;
  try {
    parsed = JSON.parse(target);
  } catch {
    throw new Error('Invalid email target (expected JSON with host, port, from, to)');
  }
  const t = parsed as Partial<EmailTarget>;
  if (!t.host || !t.port || !t.from || !t.to) {
    throw new Error('Invalid email target (expected JSON with host, port, from, to)');
  }
  return t as EmailTarget;
}

/** Send an email through SMTP (target = JSON config, credentials encrypted at rest). */
async function sendEmail(target: string, subject: string, message: string): Promise<void> {
  const cfg = parseEmailTarget(target);
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
  });
  try {
    await transport.sendMail({ from: cfg.from, to: cfg.to, subject, text: message });
  } finally {
    transport.close();
  }
}

/**
 * Parse a `config_json` blob into a typed object, swallowing the
 * `null` / `''` / malformed case. Channels created before G-18 PR #24
 * have nothing stored here and we want them to keep working with the
 * default plain-content payload.
 */
function parseChannelConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Dispatch a message to one channel by type. */
export async function dispatchChannel(
  type: string,
  target: string,
  event: AppEvent,
  message: string,
  options?: { configJson?: string | null },
): Promise<void> {
  if (type === 'telegram') {
    const idx = target.lastIndexOf(':');
    const botToken = idx > 0 ? target.slice(0, idx) : '';
    const chatId = idx > 0 ? target.slice(idx + 1) : '';
    if (!botToken || !chatId) throw new Error('Invalid Telegram target (expected botToken:chatId)');
    await sendTelegram(botToken, chatId, message);
  } else if (type === 'webhook') {
    await sendWebhook(target, { event: event.action, entity: event.entity, ts: event.ts, message });
  } else if (type === 'discord') {
    // Forward the operator's embed / identity overrides. Each key is
    // optional; missing keys fall through to Discord's default
    // webhook identity and the plain `content` line.
    const cfg = parseChannelConfig(options?.configJson);
    const discordOpts: DiscordChannelConfig = {};
    if (typeof cfg.username === 'string') discordOpts.username = cfg.username;
    if (typeof cfg.avatarUrl === 'string') discordOpts.avatarUrl = cfg.avatarUrl;
    if (typeof cfg.title === 'string') discordOpts.title = cfg.title;
    if (typeof cfg.color === 'number' && Number.isFinite(cfg.color)) discordOpts.color = cfg.color;
    await sendDiscord(target, message, discordOpts);
  } else if (type === 'slack') {
    await sendSlack(target, message);
  } else if (type === 'ntfy') {
    await sendNtfy(target, message);
  } else if (type === 'email') {
    await sendEmail(target, `NineDeploy: ${event.action}`, message);
  } else {
    // Unknown channel types would otherwise log a misleading "sent" entry.
    throw new Error(`Unknown notification channel type: ${type}`);
  }
}

/**
 * Process an event through all active notification channels.
 * Telegram target format: `botToken:chatId`
 * Webhook/Discord/Slack target format: URL
 * ntfy target format: topic URL
 * Email target format: JSON {host, port, from, to, user?, pass?}
 *
 * Channels are dispatched CONCURRENTLY so a slow target (e.g. a dead SMTP with
 * retries) never stalls the event bus or every other channel behind it.
 */
export async function notifyEvent(db: DB, event: AppEvent): Promise<void> {
  let channels: NotificationChannel[];
  try {
    channels = await db.query.notificationChannels.findMany();
  } catch {
    return; // table might not exist yet
  }

  await Promise.all(
    channels.map(async (ch) => {
      if (!ch.active) return;
      if (!matchesFilter(event.action, ch.eventFilter)) return;

      const message = formatMessage(event.action, event.entity);
      const target = decrypt(ch.targetEncrypted);

      try {
        const attempts = await withRetry(() => dispatchChannel(ch.type, target, event, message, { configJson: ch.configJson }));
        await db.insert(notificationLog).values({ channelId: ch.id, event: event.action, entity: event.entity, status: 'sent', attempts });
      } catch (err) {
        await db.insert(notificationLog).values({
          channelId: ch.id,
          event: event.action,
          entity: event.entity,
          status: 'failed',
          attempts: RETRY_DELAYS_MS.length + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

/**
 * Send an ad-hoc email through the first active email channel (used by the
 * forgot-password flow). Returns true when a channel existed and the message
 * was sent; false when no email channel is configured (the caller then relies
 * on admin-issued links). Failures are logged into notification_log like any
 * other delivery.
 */
export async function sendSystemEmail(db: DB, subject: string, text: string): Promise<boolean> {
  let channel: NotificationChannel | undefined;
  try {
    channel = (await db.query.notificationChannels.findMany()).find((c) => c.active && c.type === 'email');
  } catch {
    return false; // table might not exist yet
  }
  if (!channel) return false;
  const target = decrypt(channel.targetEncrypted);
  try {
    await withRetry(() => sendEmail(target, subject, text));
    await db.insert(notificationLog).values({ channelId: channel.id, event: 'email.system', entity: subject, status: 'sent', attempts: 1 });
    return true;
  } catch (err) {
    await db.insert(notificationLog).values({
      channelId: channel.id,
      event: 'email.system',
      entity: subject,
      status: 'failed',
      attempts: RETRY_DELAYS_MS.length + 1,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// Re-export encrypt for the notifications module
export { encrypt };
