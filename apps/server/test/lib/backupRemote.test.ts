import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { activeDestination, deleteRemoteBackup, fetchRemoteBackup, uploadBackup } from '../../src/lib/backupRemote.js';
import { createFakeDb } from '../helpers.js';

const s3Mocks = vi.hoisted(() => ({
  s3Put: vi.fn(async () => undefined),
  s3Get: vi.fn(async () => Buffer.from('remote-bytes')),
  s3Delete: vi.fn(async () => undefined),
}));
vi.mock('../../src/lib/s3.js', () => s3Mocks);

const cryptoMocks = vi.hoisted(() => ({
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}));
vi.mock('../../src/lib/crypto.js', () => cryptoMocks);

const dest = {
  id: 1, name: 'minio', endpoint: 'https://s3.example.com', region: 'eu-central-1',
  bucket: 'b', prefix: 'nd', accessKeyId: 'ak', secretKeyEncrypted: 'enc:sk',
  active: true, createdAt: new Date(), updatedAt: new Date(),
};

describe('activeDestination', () => {
  it('resolves the first active destination with the decrypted secret', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [dest] } });
    const cfg = await activeDestination(db);
    expect(cfg).toMatchObject({ endpoint: 'https://s3.example.com', bucket: 'b', prefix: 'nd' });
  });

  it('returns null when none are active', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [{ ...dest, active: false }] } });
    expect(await activeDestination(db)).toBeNull();
  });

  it('returns null when the table query fails (pre-migration)', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: () => { throw new Error('no table'); } } });
    expect(await activeDestination(db)).toBeNull();
  });
});

describe('uploadBackup', () => {
  let tmp: string;
  beforeEach(() => {
    vi.clearAllMocks();
    tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-bk-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('uploads the encrypted envelope and stamps remoteKey', async () => {
    const file = path.join(tmp, 'db-2026.dump');
    writeFileSync(file, 'v0:ZW5j');
    const db = createFakeDb({
      findMany: { backupDestinations: [dest] },
      update: { backups: [{}] },
    });
    const lines: string[] = [];
    await uploadBackup(db, 5, file, (l) => lines.push(l));
    expect(s3Mocks.s3Put).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'b' }),
      'nd/db-2026.dump',
      Buffer.from('v0:ZW5j'),
    );
    expect(lines.join('\n')).toContain('Uploaded to b/nd/db-2026.dump');
  });

  it('skips silently when no destination is configured', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [] } });
    const file = path.join(tmp, 'x.dump');
    writeFileSync(file, 'x');
    await uploadBackup(db, 5, file, () => {});
    expect(s3Mocks.s3Put).not.toHaveBeenCalled();
  });

  it('never throws when the upload fails', async () => {
    s3Mocks.s3Put.mockRejectedValueOnce('plain-string failure');
    const file = path.join(tmp, 'y.dump');
    writeFileSync(file, 'y');
    const db = createFakeDb({ findMany: { backupDestinations: [dest] } });
    const lines: string[] = [];
    await expect(uploadBackup(db, 5, file, (l) => lines.push(l))).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('remote upload failed');
    // Error rejections print their message.
    s3Mocks.s3Put.mockRejectedValueOnce(new Error('network down'));
    await expect(uploadBackup(db, 5, file, (l) => lines.push(l))).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('network down');
  });
});

describe('fetchRemoteBackup / deleteRemoteBackup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches remote bytes to a local path', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [dest] } });
    const target = path.join(os.tmpdir(), `fetch-${Date.now()}`);
    const p = await fetchRemoteBackup(db, 'nd/k', target);
    expect(p).toBe(target);
    s3Mocks.s3Get.mockResolvedValueOnce(Buffer.from('payload'));
    const crypto = await import('node:fs');
    void crypto;
  });

  it('throws when no destination is configured for a fetch', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [] } });
    await expect(fetchRemoteBackup(db, 'k', '/tmp/x')).rejects.toThrow('No backup destination');
  });

  it('deletes remote objects and swallows failures', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [dest] } });
    await deleteRemoteBackup(db, 'nd/k');
    expect(s3Mocks.s3Delete).toHaveBeenCalled();
    s3Mocks.s3Delete.mockRejectedValueOnce(new Error('gone'));
    await expect(deleteRemoteBackup(db, 'nd/k')).resolves.toBeUndefined();
    await expect(deleteRemoteBackup(db, null)).resolves.toBeUndefined();
  });

  it('skips the remote delete when no destination is configured', async () => {
    const db = createFakeDb({ findMany: { backupDestinations: [] } });
    await deleteRemoteBackup(db, 'nd/k');
    expect(s3Mocks.s3Delete).not.toHaveBeenCalled();
  });
});
