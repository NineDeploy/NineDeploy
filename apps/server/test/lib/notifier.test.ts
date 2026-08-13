import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationLog } from '@ninedeploy/db';
import { notifyEvent } from '../../src/lib/notifier.js';
import { encrypt } from '../../src/lib/crypto.js';

const KEY_HEX = 'b'.repeat(64);

const fetchMock = vi.hoisted(() => vi.fn());

vi.stubGlobal('fetch', fetchMock);

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

  it('records a failed log entry when telegram returns an error', async () => {
    fetchMock.mockResolvedValue(errResponse(401, 'unauthorized'));
    const channels = [
      { id: 6, type: 'telegram', targetEncrypted: encrypt('tok:chat'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Telegram API 401: unauthorized' }));
  });

  it('records a failed log entry when a webhook returns an error', async () => {
    fetchMock.mockResolvedValue(errResponse(500, 'boom'));
    const channels = [
      { id: 7, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Webhook 500' }));
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
    fetchMock.mockResolvedValue(errResponse(403, 'forbidden'));
    const channels = [
      { id: 9, type: 'discord', targetEncrypted: encrypt('https://discord.com/api/webhooks/x'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'Discord 403' }));
  });

  it('records a failure when fetch rejects with a non-Error value', async () => {
    fetchMock.mockRejectedValue('network gone');
    const channels = [
      { id: 10, type: 'webhook', targetEncrypted: encrypt('https://hooks.example.com'), eventFilter: '', active: true },
    ];
    const { db, lastValues } = makeDb(channels);
    await notifyEvent(db, event);

    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'network gone' }));
  });

  it('logs a sent entry for a channel with an unknown type without calling fetch', async () => {
    const channels = [
      { id: 11, type: 'smtp', targetEncrypted: encrypt('smtp://x'), eventFilter: '', active: true },
    ];
    const { db, insert, lastValues } = makeDb(channels);
    await notifyEvent(db, event);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(notificationLog);
    expect(lastValues()).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
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
});
