/**
 * Per-account failed-login tracking (in-memory — resets on restart, which is
 * acceptable: the goal is stopping online brute-force, not forensic record).
 *
 * 5 consecutive failures lock the account for 15 minutes regardless of source
 * IP (complements the per-IP rate limit, which one attacker with rotating IPs
 * can sidestep).
 */

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

interface Entry {
  failures: number;
  lockedUntil: number;
  lastSeen: number;
}

/** Idle entries are dropped after one lock period so the map cannot grow unbounded. */
const IDLE_TTL_MS = LOCK_MS;

const entries = new Map<string, Entry>();

/** Prune expired locks and idle entries so the map cannot grow unbounded. */
function sweep(now: number): void {
  for (const [key, e] of entries) {
    if (e.lockedUntil < now && (e.failures === 0 || e.lastSeen < now - IDLE_TTL_MS)) entries.delete(key);
  }
}

export function isLocked(email: string): boolean {
  const e = entries.get(email.toLowerCase());
  return !!e && e.lockedUntil > Date.now();
}

/** Record a failed attempt; returns true when this attempt caused a lock. */
export function recordFailure(email: string): boolean {
  const key = email.toLowerCase();
  const now = Date.now();
  sweep(now);
  const e = entries.get(key) ?? { failures: 0, lockedUntil: 0, lastSeen: now };
  e.failures += 1;
  e.lastSeen = now;
  if (e.failures >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    e.failures = 0; // after the lock expires, start counting fresh
  }
  entries.set(key, e);
  return e.lockedUntil > now;
}

/** Successful login clears any pending failure count (locks stay until expiry). */
export function recordSuccess(email: string): void {
  entries.delete(email.toLowerCase());
}
