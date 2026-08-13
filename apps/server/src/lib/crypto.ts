import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { config } from '../config.js';

/** Argon2id password hashing (recommended defaults from @node-rs/argon2). */
export async function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

/** Verify a plaintext password against an argon2 hash. Never throws on mismatch. */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashed, password);
  } catch {
    return false;
  }
}

/** SHA-256 hex digest — used to hash API tokens before storing/comparing. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** URL-safe random token (base64url). Used for opaque API tokens and refresh ids. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// ── Symmetric encryption (secrets at rest) ────────────────────────────────
// AES-256-GCM with a per-instance master key. Foundation for secret/env-var
// encryption (fully wired up in the secrets phase).

let masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const envKey = process.env['NINEDEPLOY_MASTER_KEY'];
  if (envKey) {
    masterKey = Buffer.from(envKey, 'hex');
  } else {
    const file = config.paths.masterKeyFile;
    if (existsSync(file)) {
      masterKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
    } else {
      mkdirSync(path.dirname(file), { recursive: true });
      masterKey = randomBytes(32);
      writeFileSync(file, masterKey.toString('hex'), { mode: 0o600 });
    }
  }
  if (masterKey.length !== 32) throw new Error('NINEDEPLOY_MASTER_KEY must decode to 32 bytes');
  return masterKey;
}

/** Encrypt plaintext → "iv:tag:ciphertext" (all base64). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join(':');
}

/** Decrypt a value produced by `encrypt()`. */
export function decrypt(payload: string): string {
  const [ivB, tagB, encB] = payload.split(':') as [string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
