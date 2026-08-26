import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationLog } from '@ninedeploy/db';
import { notifyEvent, parseEmailTarget, sendSystemEmail, withRetry } from '../../src/lib/notifier.js';
import { encrypt } from '../../src/lib/crypto.js';

const KEY_HEX = 'b'.repeat(64);

const fetchMock = vi.hoisted(() => vi.fn());

vi.stubGlobal('fetch', fetchMock);

// L-11 wiring lives in `test/egressGuard.test.ts`, which exercises the REAL
// guard against these same call sites. Here the guard is stubbed so these
// tests stay about delivery logic and need no DNS.
vi.mock('../../src/lib/egressGuard.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/egressGuard.js')>('../../src/lib/egressGuard.js');
  return { ...actual, guardedFetch: (url: string, init?: RequestInit) => fetch(url, init) };
});

interface FakeDb {
  db: never;
  insert: ReturnType<typeof vi.fn>;
  lastValues: () => ReturnType<typeof vi.fn>;
}

function makeDb(channels: unknown[], findManyImpl?: () => Promise<unknown>): FakeDb {
  const insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }));
  const lastValues = () => {
    const result = insert.mock.results.at(-1)?.value as { values: ReturnType<typeof vi.fn> };
    return result.values;
  };
  const db = {
    query: {
      notificationChannels: {
        findMany: findManyImpl ?? (async () => channels),
      },
    },
    insert,
  };
  return { db: db as never, insert, lastValues };
}

function okResponse() {
  return { ok: true, status: 200, text: async () => '' };
}

function errResponse(status: number, body: string) {
  return { ok: false, status, text: async () => body };
}

const event = { id: 1, action: 'deploy.completed', entity: 'web', ts: '2026-01-01T00:00:00.000Z' };

describe('notifyEvent', () => {
  beforeEach(() => {
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', KEY_HEX);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when there are no channels', async () => {
    const { db, insert } = makeDb([]);
    await notifyEvent(db, event);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns silently when the channels query fails (table missing)', async () => {
    const { db, insert } = makeDb([], async () => {
      throw new Error('no such table');
    });
    await expect(notifyEvent(db, event)).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips inactive channels and filter mismatches', async () => {
    const channels = [
      { id: 1, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: 'service', active: false },
      { id: 2, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: 'backup', active: true },
    ];
    const { db, insert } = makeDb(channels);
    await notifyEvent(db, event);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('delivers to a webhook channel when the filter matches', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 3, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com/hook'), eventFilter: 'deploy,service', active: true },
    ];
    const { db, insert, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/hook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'deploy.completed', entity: 'web', ts: event.ts, message: '🚀 deploy completed: web' }),
      }),
    );
    expect(insert).toHaveBeenCalledWith(notificationLog);
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  it('delivers to a telegram channel with bot token and chat id', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 4, type: 'telegram', targetEncrypted: encrypt('12345:67890'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.telegram.org/bot12345/sendMessage');
    expect(fetchMock.mock.calls[0]![1]!.body).toContain('67890');
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  it('correctly parses real telegram bot tokens that contain an internal colon', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 44, type: 'telegram', targetEncrypted: encrypt('123456789:ABC-def_GHI:987654321'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.telegram.org/bot123456789:ABC-def_GHI/sendMessage');
    expect(fetchMock.mock.calls[0]![1]!.body).toContain('987654321');
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  it('logs a failure for an invalid telegram target (missing chat id)', async () => {
    const channels = [
      { id: 5, type: 'telegram', targetEncrypted: encrypt('only-a-token'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastValues()).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Invalid Telegram target (expected botToken:chatId)' }),
    );
  });

  it('records a failed log entry when telegram returns an error (after retries)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errResponse(401, 'unauthorized'));
    const channels = [
      { id: 6, type: 'telegram', targetEncrypted: encrypt('tok:chat'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', attempts: 3, error: 'Telegram API 401: unauthorized' }));
  });

  it('records a failed log entry when a webhook returns an error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errResponse(500, 'boom'));
    const channels = [
      { id: 7, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Webhook 500' }));
  });

  it('retries a transient failure and records success with the attempt count', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(errResponse(503, 'overloaded')).mockResolvedValue(okResponse());
    const channels = [
      { id: 16, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', attempts: 2 }));
  });

  it('delivers to a discord channel', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 8, type: 'discord', targetEncrypted: encrypt('https://discord.com/api/webhooks/x'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/x',
      expect.objectContaining({ body: JSON.stringify({ content: '🚀 deploy completed: web' }) }),
    );
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  it('records a failure when discord returns an error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errResponse(403, 'forbidden'));
    const channels = [
      { id: 9, type: 'discord', targetEncrypted: encrypt('https://discord.com/api/webhooks/x'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Discord 403' }));
  });

  it('delivers to a slack channel', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 17, type: 'slack', targetEncrypted: encrypt('https://hooks.slack.com/services/T/B/x'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/T/B/x',
      expect.objectContaining({ body: JSON.stringify({ text: '🚀 deploy completed: web' }) }),
    );
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', attempts: 1 }));
  });

  it('records a failure when slack returns an error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errResponse(404, 'not found'));
    const channels = [
      { id: 18, type: 'slack', targetEncrypted: encrypt('https://hooks.slack.com/services/T/B/x'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Slack 404' }));
  });

  it('delivers to an ntfy topic as plain text', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 19, type: 'ntfy', targetEncrypted: encrypt('https://ntfy.sh/my-alerts'), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, event);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ntfy.sh/my-alerts',
      expect.objectContaining({ headers: { 'Content-Type': 'text/plain' }, body: '🚀 deploy completed: web' }),
    );
  });

  it('records a failure when ntfy returns an error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errResponse(429, 'too many'));
    const channels = [
      { id: 20, type: 'ntfy', targetEncrypted: encrypt('https://ntfy.sh/my-alerts'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'ntfy 429' }));
  });

  it('delivers to an email channel via SMTP', async () => {
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: '1' })),
      close: vi.fn(),
    }));
    vi.doMock('nodemailer', () => ({ createTransport }));
    const target = JSON.stringify({ host: 'smtp.example.com', port: 587, from: 'a@example.com', to: 'b@example.com', user: 'a', pass: 'secret' });
    const channels = [
      { id: 21, type: 'email', targetEncrypted: encrypt(target), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 587, auth: { user: 'a', pass: 'secret' } }));
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
    vi.doUnmock('nodemailer');
  });

  it('records a failure for a malformed email target', async () => {
    vi.useFakeTimers();
    const channels = [
      { id: 22, type: 'email', targetEncrypted: encrypt('not-json'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: expect.stringContaining('Invalid email target') }));
  });

  it('records a failure when fetch rejects with a non-Error value', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue('network gone');
    const channels = [
      { id: 10, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'network gone' }));
  });

  it('records a failure for a channel with an unknown type (no misleading sent entry)', async () => {
    vi.useFakeTimers();
    const channels = [
      { id: 11, type: 'smtp', targetEncrypted: encrypt('smtp://x'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, event);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastValues()).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Unknown notification channel type: smtp' }),
    );
  });

  it('includes the entity in the message when present', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 12, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, { id: 2, action: 'service.created', entity: 'blog', ts: event.ts });
    expect(fetchMock.mock.calls[0]![1]!.body).toContain('🖥️ service created: blog');
  });

  it('formats actions without a dot, unknown subjects, and a null entity', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 13, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, { id: 3, action: 'custom', entity: null, ts: event.ts });
    // verb falls back to the whole action, subject is not in the emoji map (•),
    // and a null entity produces no suffix.
    expect(fetchMock.mock.calls[0]![1]!.body).toContain('• custom custom');
  });

  it('HTML-escapes a hostile entity so Telegram parse_mode cannot break', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 14, type: 'telegram', targetEncrypted: encrypt('123:abc,456'), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, { id: 4, action: 'service.created', entity: '<b>&x</b>', ts: event.ts });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { text: string };
    expect(body.text).toContain('&lt;b&gt;&amp;x&lt;/b&gt;');
    expect(body.text).not.toContain('<b>');
  });

  it('sends every dispatch with an abort signal (bounded timeout) and records failures', async () => {
    vi.useFakeTimers();
    // A stalled target aborts via the signal; simulate by rejecting when one is present.
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.signal instanceof AbortSignal
        ? Promise.reject(new Error('The operation was aborted'))
        : Promise.resolve(okResponse()),
    );
    const channels = [
      { id: 15, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    const pending = notifyEvent(db, { id: 5, action: 'service.created', entity: 'x', ts: event.ts });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // The aborted dispatch failed fast and was recorded — it did not hang.
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('delivers to an email channel without auth when user is absent', async () => {
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: '2' })),
      close: vi.fn(),
    }));
    vi.doMock('nodemailer', () => ({ createTransport }));
    const target = JSON.stringify({ host: 'mx.example.com', port: 25, from: 'a@example.com', to: 'b@example.com' });
    const channels = [
      { id: 24, type: 'email', targetEncrypted: encrypt(target), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, event);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'mx.example.com', port: 25, auth: undefined, secure: false }));
    vi.doUnmock('nodemailer');
  });

  it('treats a user without a password as an empty password', async () => {
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: '3' })),
      close: vi.fn(),
    }));
    vi.doMock('nodemailer', () => ({ createTransport }));
    const target = JSON.stringify({ host: 'smtp.example.com', port: 465, from: 'a@example.com', to: 'b@example.com', user: 'a' });
    const channels = [
      { id: 25, type: 'email', targetEncrypted: encrypt(target), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, event);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'a', pass: '' }, secure: true }));
    vi.doUnmock('nodemailer');
  });

  it('formats the alert subject with a bell emoji', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const channels = [
      { id: 23, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db } = makeDb(channels);
    await notifyEvent(db, { id: 6, action: 'alert.fired', entity: 'high-cpu', ts: event.ts });
    expect(fetchMock.mock.calls[0]![1]!.body).toContain('🔔 alert fired: high-cpu');
  });
});

describe('withRetry', () => {
  it('returns 1 on immediate success', async () => {
    const fn = vi.fn(async () => undefined);
    await expect(withRetry(fn, [])).resolves.toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries with the given delays and returns the attempt count', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      if (fn.mock.calls.length < 3) throw new Error('transient');
    });
    const pending = withRetry(fn, [100, 200]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting the delays', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new Error('always');
    });
    const pending = withRetry(fn, [50]).catch((e) => e as Error);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ message: 'always' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('parseEmailTarget', () => {
  it('parses a full target', () => {
    expect(parseEmailTarget('{"host":"h","port":465,"from":"a@x.com","to":"b@x.com"}')).toEqual({
      host: 'h', port: 465, from: 'a@x.com', to: 'b@x.com',
    });
  });

  it('rejects non-JSON input', () => {
    expect(() => parseEmailTarget('nope')).toThrow('Invalid email target');
  });

  it('rejects JSON missing required fields', () => {
    expect(() => parseEmailTarget('{"host":"h"}')).toThrow('Invalid email target');
  });
});

describe('sendSystemEmail', () => {
  beforeEach(() => {
    // Earlier notifyEvent tests enable fake timers and (historically) don't
    // always restore them; the retry backoff below needs real timers.
    vi.useRealTimers();
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', KEY_HEX);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('nodemailer');
  });

  it('returns false when no active email channel exists', async () => {
    const { db } = makeDb([{ id: 1, type: 'telegram', targetEncrypted: 'x', eventFilter: '', active: true }]);
    await expect(sendSystemEmail(db as never, 'subject', 'text')).resolves.toBe(false);
  });

  it('returns false when the channels query fails (table missing)', async () => {
    const { db } = makeDb([], async () => {
      throw new Error('no such table');
    });
    await expect(sendSystemEmail(db as never, 'subject', 'text')).resolves.toBe(false);
  });

  it('sends through the first active email channel and logs the delivery', async () => {
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: '1' })),
      close: vi.fn(),
    }));
    vi.doMock('nodemailer', () => ({ createTransport }));
    const target = JSON.stringify({ host: 'smtp.example.com', port: 587, from: 'a@example.com', to: 'b@example.com' });
    const { db, lastValues } = makeDb([
      { id: 30, type: 'email', targetEncrypted: encrypt(target), eventFilter: '', active: true },
    ]);
    await expect(sendSystemEmail(db as never, 'NineDeploy password reset', 'body')).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalled();
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', event: 'email.system' }));
  });

  it('logs a failed delivery and returns false (non-Error rejections stringified)', async () => {
    vi.doMock('nodemailer', () => ({
      createTransport: () => ({
        sendMail: async () => {
          throw 'smtp-down'; // non-Error rejection exercises the String() branch
        },
        close: vi.fn(),
      }),
    }));
    const target = JSON.stringify({ host: 'smtp.example.com', port: 587, from: 'a@example.com', to: 'b@example.com' });
    const { db, lastValues } = makeDb([
      { id: 31, type: 'email', targetEncrypted: encrypt(target), eventFilter: '', active: true },
    ]);
    await expect(sendSystemEmail(db as never, 'subject', 'text')).resolves.toBe(false);
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'smtp-down' }));
  });

  it('logs Error rejections with their message', async () => {
    vi.doMock('nodemailer', () => ({
      createTransport: () => ({
        sendMail: async () => {
          throw new Error('smtp refused');
        },
        close: vi.fn(),
      }),
    }));
    const target = JSON.stringify({ host: 'smtp.example.com', port: 587, from: 'a@example.com', to: 'b@example.com' });
    const { db, lastValues } = makeDb([
      { id: 32, type: 'email', targetEncrypted: encrypt(target), eventFilter: '', active: true },
    ]);
    await expect(sendSystemEmail(db as never, 'subject', 'text')).resolves.toBe(false);
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'smtp refused' }));
  });
});
