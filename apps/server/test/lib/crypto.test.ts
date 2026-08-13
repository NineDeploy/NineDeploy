import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from '../../src/lib/crypto.js';

const KEY_HEX = 'a'.repeat(64); // 32 bytes

describe('crypto primitives', () => {
  beforeEach(() => {
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', KEY_HEX);
  });

  it('sha256 produces the expected digest', () => {
    const expected = createHash('sha256').update('hello').digest('hex');
    expect(crypto.sha256('hello')).toBe(expected);
    expect(crypto.sha256('hello')).not.toBe(crypto.sha256('world'));
  });

  it('randomToken produces URL-safe tokens of the requested length', () => {
    expect(crypto.randomToken()).toHaveLength(43); // 32 bytes → base64url
    expect(crypto.randomToken(16)).toHaveLength(22);
    expect(crypto.randomToken()).not.toBe(crypto.randomToken());
    expect(crypto.randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashPassword/verifyPassword roundtrip succeeds for the right password', async () => {
    const hash = await crypto.hashPassword('s3cret-pass');
    expect(hash).not.toContain('s3cret-pass');
    await expect(crypto.verifyPassword(hash, 's3cret-pass')).resolves.toBe(true);
  });

  it('verifyPassword returns false for a wrong password', async () => {
    const hash = await crypto.hashPassword('right');
    await expect(crypto.verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('verifyPassword returns false for a malformed hash', async () => {
    await expect(crypto.verifyPassword('not-a-valid-argon2-hash', 'x')).resolves.toBe(false);
  });
});

describe('encrypt/decrypt with an env master key', () => {
  beforeEach(() => {
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', KEY_HEX);
  });

  it('roundtrips plaintext', () => {
    const ct = crypto.encrypt('my secret value');
    expect(ct.split(':')).toHaveLength(3); // iv:tag:ciphertext
    expect(crypto.decrypt(ct)).toBe('my secret value');
  });

  it('produces unique ciphertext per call (random IV)', () => {
    const a = crypto.encrypt('same');
    const b = crypto.encrypt('same');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe(crypto.decrypt(b));
  });

  it('decrypt rejects tampered payloads', () => {
    const ct = crypto.encrypt('data');
    const parts = ct.split(':');
    const tampered = [parts[0], 'AAAAAAAAAAAAAAAAAAAAAA==', parts[2]].join(':');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('decrypt rejects a malformed payload', () => {
    expect(() => crypto.decrypt('not-a-valid-payload')).toThrow();
  });
});

describe('master key resolution from the key file', () => {
  const tmp = fsTempDir();
  const freshDir = path.join(tmp, 'fresh');
  const existingDir = path.join(tmp, 'existing');
  const existingKey = randomBytes(32).toString('hex');

  beforeAll(() => {
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(path.join(existingDir, 'master.key'), existingKey, { mode: 0o600 });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('creates and persists a master key file when none exists', async () => {
    vi.resetModules();
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', '');
    vi.stubEnv('NINEDEPLOY_DATA_DIR', freshDir);
    const mod = await import('../../src/lib/crypto.js');
    const ct = mod.encrypt('hello');
    expect(mod.decrypt(ct)).toBe('hello');
    const keyFile = path.join(freshDir, 'master.key');
    expect(existsSync(keyFile)).toBe(true);
    expect(readFileSync(keyFile, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads an existing master key file', async () => {
    vi.resetModules();
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', '');
    vi.stubEnv('NINEDEPLOY_DATA_DIR', existingDir);
    const mod = await import('../../src/lib/crypto.js');
    const ct = mod.encrypt('from-file');
    expect(mod.decrypt(ct)).toBe('from-file');
  });

  it('throws when the env master key is not 32 bytes', async () => {
    vi.resetModules();
    vi.stubEnv('NINEDEPLOY_MASTER_KEY', 'aabb'); // 2 bytes
    vi.stubEnv('NINEDEPLOY_DATA_DIR', freshDir);
    const mod = await import('../../src/lib/crypto.js');
    expect(() => mod.encrypt('x')).toThrow('must decode to 32 bytes');
  });
});

function fsTempDir(): string {
  const dir = path.join(os.tmpdir(), `ninedeploy-crypto-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
