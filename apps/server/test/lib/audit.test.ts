import { describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../src/lib/events.js';

const notifyMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../src/lib/notifier.js', () => ({ notifyEvent: notifyMock }));

const { audit } = await import('../../src/lib/audit.js');

function makeDb(valuesImpl?: () => Promise<unknown>) {
  const values = vi.fn(valuesImpl ?? (async () => undefined));
  return { db: { insert: vi.fn(() => ({ values })) } as never, values };
}

describe('audit', () => {
  it('writes an audit row, publishes an event, and fires the notifier', async () => {
    const { db, values } = makeDb();
    const before = eventBus.backlog().length;

    await audit(db, 3, 'service.created', 'web', { via: 'cli' });

    expect(values).toHaveBeenCalledWith({ userId: 3, action: 'service.created', entity: 'web', meta: { via: 'cli' } });
    expect(eventBus.backlog()).toHaveLength(before + 1);
    expect(eventBus.backlog().at(-1)).toMatchObject({ action: 'service.created', entity: 'web' });
    expect(notifyMock).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'service.created' }));
  });

  it('normalizes a missing entity to null and omits meta', async () => {
    const { db, values } = makeDb();
    await audit(db, null, 'user.login');
    expect(values).toHaveBeenCalledWith({ userId: null, action: 'user.login', entity: undefined, meta: undefined });
    const published = eventBus.backlog().at(-1);
    expect(published).toMatchObject({ action: 'user.login', entity: null });
  });

  it('never throws when the insert fails and still publishes the event', async () => {
    const { db } = makeDb(async () => {
      throw new Error('db locked');
    });
    await expect(audit(db, 1, 'deploy.failed', 'svc')).resolves.toBeUndefined();
    expect(eventBus.backlog().at(-1)).toMatchObject({ action: 'deploy.failed', entity: 'svc' });
  });

  it('resolves even when the notifier rejects (fire-and-forget)', async () => {
    notifyMock.mockRejectedValueOnce(new Error('notifier down'));
    const { db } = makeDb();
    await expect(audit(db, 2, 'backup.completed', 'db1')).resolves.toBeUndefined();
  });
});
