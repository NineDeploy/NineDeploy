import { describe, expect, it, vi } from 'vitest';
import { settings } from '@ninedeploy/db';
import { getSetting, setSetting } from '../../src/lib/settings.js';

function makeDb(row?: { key: string; value: unknown }) {
  const findFirst = vi.fn(async () => row);
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return {
    db: { query: { settings: { findFirst } }, insert } as never,
    findFirst,
    values,
    onConflictDoUpdate,
    insert,
  };
}

describe('getSetting', () => {
  it('returns the stored boolean', async () => {
    const { db } = makeDb({ key: 'allow_registration', value: false });
    await expect(getSetting(db, 'allow_registration', true)).resolves.toBe(false);
  });

  it('falls back when no row exists', async () => {
    const { db } = makeDb(undefined);
    await expect(getSetting(db, 'allow_registration', true)).resolves.toBe(true);
  });

  it('falls back when the stored value is not a boolean (e.g. legacy JSON)', async () => {
    const { db } = makeDb({ key: 'k', value: 'yes' });
    await expect(getSetting(db, 'k', true)).resolves.toBe(true);
  });
});

describe('setSetting', () => {
  it('upserts the value keyed by the settings primary key', async () => {
    const h = makeDb();
    await setSetting(h.db, 'allow_registration', false);
    expect(h.insert).toHaveBeenCalledWith(settings);
    const valuesCall = (h.insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> }).values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'allow_registration', value: false }),
    );
  });
});
