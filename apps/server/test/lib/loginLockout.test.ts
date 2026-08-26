import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocked, recordFailure, recordSuccess } from '../../src/lib/loginLockout.js';

describe('loginLockout', () => {
  it('does not lock before 5 consecutive failures', () => {
    for (let i = 0; i < 4; i++) {
      expect(recordFailure('u@x.y')).toBe(false);
      expect(isLocked('u@x.y')).toBe(false);
    }
  });

  it('locks on the 5th failure', () => {
    for (let i = 0; i < 4; i++) recordFailure('v@x.y');
    expect(recordFailure('v@x.y')).toBe(true);
    expect(isLocked('v@x.y')).toBe(true);
  });

  it('a locked account stays locked even though failures restart', () => {
    expect(isLocked('v@x.y')).toBe(true);
    recordFailure('v@x.y');
    expect(isLocked('v@x.y')).toBe(true);
  });

  it('success clears pending failures', () => {
    for (let i = 0; i < 3; i++) recordFailure('w@x.y');
    recordSuccess('w@x.y');
    expect(isLocked('w@x.y')).toBe(false);
    // counting starts fresh after a success
    for (let i = 0; i < 4; i++) expect(recordFailure('w@x.y')).toBe(false);
    expect(recordFailure('w@x.y')).toBe(true);
  });

  it('matches emails case-insensitively', () => {
    for (let i = 0; i < 5; i++) recordFailure('MiXeD@x.y');
    expect(isLocked('mixed@x.y')).toBe(true);
    expect(isLocked('other@x.y')).toBe(false);
  });

  it('unlocks after the 15-minute window and sweeps the entry', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) recordFailure('tmp@x.y');
      expect(isLocked('tmp@x.y')).toBe(true);
      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(isLocked('tmp@x.y')).toBe(false);
      // The expired entry is swept by the next failure elsewhere (map stays bounded).
      recordFailure('other2@x.y');
      expect(isLocked('tmp@x.y')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  afterEach(() => vi.useRealTimers());
});
