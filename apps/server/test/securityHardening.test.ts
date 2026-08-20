import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { secretEquals } from '../src/lib/crypto.js';
import { writeSecretFile } from '../src/lib/secretFile.js';

/**
 * Phase 3 security-scan hardening (2026-08-20): M-3 (security headers),
 * M-4 (OAuth redirect_uri from config, not the Host header), M-5 (private
 * temp files for secrets) and the constant-time half of M-6.
 *
 * The M-3 and M-4 assertions live next to their own module's tests
 * (`app.test.ts`, `oidc.test.ts`); this file covers the two new library
 * primitives and the property that made M-5 exploitable.
 */

describe('M-5: secret temp files are unguessable and private', () => {
  it('places each file in its own fresh directory', () => {
    const a = writeSecretFile('nd-test', 'x.env', 'A=1\n');
    const b = writeSecretFile('nd-test', 'x.env', 'A=1\n');
    try {
      expect(dirname(a.path)).not.toBe(dirname(b.path));
      expect(readFileSync(a.path, 'utf8')).toBe('A=1\n');
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it('creates the directory 0700 and the file 0600', () => {
    if (process.platform === 'win32') return; // POSIX mode bits only
    const f = writeSecretFile('nd-test', 'x.env', 'SECRET=1\n');
    try {
      expect(statSync(dirname(f.path)).mode & 0o777).toBe(0o700);
      expect(statSync(f.path).mode & 0o777).toBe(0o600);
    } finally {
      f.cleanup();
    }
  });

  it('cleanup removes the file and its directory, and is safe to call twice', () => {
    const f = writeSecretFile('nd-test', 'x.env', 'A=1\n');
    const dir = dirname(f.path);
    f.cleanup();
    expect(() => statSync(dir)).toThrow();
    expect(() => f.cleanup()).not.toThrow();
  });

  it('refuses to reuse a directory an attacker pre-created', () => {
    // The whole point of mkdtemp over a predictable name: the old code did
    // `writeFileSync('${tmpdir()}/nd-env-<pid>-<ms>.env')`, which FOLLOWS a
    // symlink planted at that path. Here the target of a pre-created path is
    // never written to, because every call mints a fresh random directory.
    const planted = mkdtempSync(join(tmpdir(), 'nd-test-planted-'));
    const decoy = join(planted, 'x.env');
    writeFileSync(decoy, 'ORIGINAL\n');
    const f = writeSecretFile('nd-test', 'x.env', 'SECRET=1\n');
    try {
      expect(f.path).not.toBe(decoy);
      expect(readFileSync(decoy, 'utf8')).toBe('ORIGINAL\n');
    } finally {
      f.cleanup();
    }
  });
});

describe('M-6: secretEquals compares in constant time', () => {
  it('matches equal secrets and rejects different ones', () => {
    expect(secretEquals('s3cret-token', 's3cret-token')).toBe(true);
    expect(secretEquals('s3cret-token', 's3cret-tokeM')).toBe(false);
  });

  it('handles unequal lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch; hashing both sides first is
    // what makes this safe AND keeps the stored secret's length private.
    expect(secretEquals('short', 'a-much-longer-secret-value')).toBe(false);
    expect(secretEquals('', '')).toBe(true);
    expect(secretEquals('', 'x')).toBe(false);
  });
});
