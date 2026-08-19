import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupDestinations,
  databases,
  envVars,
  logDrains,
  notificationChannels,
  oidcProviders,
  servers,
  sources,
  tunnels,
  users,
  webhooks,
} from '@ninedeploy/db';

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
      [users, [{ id: 7, v: 'totp-enc' }]],
      [oidcProviders, [{ id: 8, v: 'oidc-enc' }]],
      [backupDestinations, [{ id: 9, v: 'bkd-enc' }]],
      [servers, [{ id: 10, v: 'srv-enc' }]],
      [logDrains, [{ id: 11, v: 'drain-enc' }]],
    ]);
    const db = makeDb(rows, updates);

    const count = await rotateSecrets(db as never);

    expect(count).toBe(11); // one row per table
    // reencrypt was applied to every non-null secret (null source key is skipped).
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('ev-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('wh-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('db-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('tn-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('nc-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('src-tok');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('totp-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('oidc-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('bkd-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('srv-enc');
    expect(cryptoMock.reencrypt).toHaveBeenCalledWith('drain-enc');

    // The sources row keeps a null deploy key (not passed through reencrypt).
    const srcUpdate = updates.find((u) => u.table === sources);
    expect(srcUpdate?.values).toEqual({ tokenEncrypted: 're:src-tok', deployKeyEncrypted: null });
    // Nullable columns on users/logDrains also stay null.
    const userUpdate = updates.find((u) => u.table === users);
    expect(userUpdate?.values).toEqual({ totpSecretEncrypted: 're:totp-enc' });
    const drainUpdate = updates.find((u) => u.table === logDrains);
    expect(drainUpdate?.values).toEqual({ apiKeyEncrypted: 're:drain-enc' });
  });

  it('keeps nullable encrypted columns null without calling reencrypt', async () => {
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [users, [{ id: 7, v: null }]],
      [sources, [{ id: 6, t: null, k: null }]],
    ]);
    const db = makeDb(rows, updates);

    const count = await rotateSecrets(db as never);

    expect(count).toBe(2);
    expect(cryptoMock.reencrypt).not.toHaveBeenCalled();
    expect(updates.find((u) => u.table === users)?.values).toEqual({ totpSecretEncrypted: null });
    expect(updates.find((u) => u.table === sources)?.values).toEqual({ tokenEncrypted: null, deployKeyEncrypted: null });
  });

  it('reports zero when there is nothing to rotate', async () => {
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = makeDb(new Map(), updates);
    const count = await rotateSecrets(db as never);
    expect(count).toBe(0);
    expect(cryptoMock.reencrypt).not.toHaveBeenCalled();
  });
});
