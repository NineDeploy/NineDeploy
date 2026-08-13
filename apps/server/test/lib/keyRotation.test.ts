import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databases, envVars, notificationChannels, sources, tunnels, webhooks } from '@ninedeploy/db';

const cryptoMock = vi.hoisted(() => ({ reencrypt: vi.fn((v: string) => `re:${v}`) }));
vi.mock('../../src/lib/crypto.js', () => ({ reencrypt: cryptoMock.reencrypt }));

beforeEach(() => {
  cryptoMock.reencrypt.mockClear();
});

const { rotateSecrets } = await import('../../src/lib/keyRotation.js');

interface FakeDb {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function makeDb(rowsByTable: Map<unknown, Array<Record<string, unknown>>>, updates: Array<{ table: unknown; values: Record<string, unknown> }>): FakeDb {
  return {
    select: vi.fn(() => ({ from: vi.fn(async (table: unknown) => rowsByTable.get(table) ?? []) })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({ where: vi.fn(async () => { updates.push({ table, values }); return undefined; }) }),
    })),
  };
}

describe('rotateSecrets', () => {
  it('re-encrypts every stored secret with the active key version', async () => {
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [envVars, [{ id: 1, v: 'ev-enc' }]],
      [webhooks, [{ id: 2, v: 'wh-enc' }]],
      [databases, [{ id: 3, v: 'db-enc' }]],
      [tunnels, [{ id: 4, v: 'tn-enc' }]],
      [notificationChannels, [{ id: 5, v: 'nc-enc' }]],
      // sources: one null credential column to exercise the nullable path
      [sources, [{ id: 6, t: 'src-tok', k: null }]],
    ]);
    const db = makeDb(rows, updates);

    const count = await rotateSecrets(db as never);

    expect(count).toBe(6); // one row per table
    // reencrypt was applied to every non-null secret (null source key is skipped).
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('ev-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('wh-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('db-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('tn-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('nc-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('src-tok');

    // The sources row keeps a null deploy key (not passed through reencrypt).
    const srcUpdate = updates.find((u) => u.table === sources);
    expect(srcUpdate?.values).toEqual({ tokenEncrypted: 're:src-tok', deployKeyEncrypted: null });
  });

  it('reports zero when there is nothing to rotate', async () => {
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = makeDb(new Map(), updates);
    const count = await rotateSecrets(db as never);
    expect(count).toBe(0);
    expect(cryptoMock.reencrypt).not.toHaveBeenCalled();
  });
});
