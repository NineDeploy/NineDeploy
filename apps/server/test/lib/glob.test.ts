import { describe, expect, it } from 'vitest';
import { globToRegExp, isSafeWatchPath, matchesAny, parseWatchPaths } from '../../src/lib/glob.js';

describe('globToRegExp', () => {
  it('matches exact paths and rejects others', () => {
    const re = globToRegExp('apps/api/index.ts');
    expect(re.test('apps/api/index.ts')).toBe(true);
    expect(re.test('apps/api/other.ts')).toBe(false);
  });

  it('supports * within a segment (not across /)', () => {
    const re = globToRegExp('apps/*/index.ts');
    expect(re.test('apps/api/index.ts')).toBe(true);
    expect(re.test('apps/web/src/index.ts')).toBe(false);
  });

  it('supports ** across segments', () => {
    const re = globToRegExp('services/api/**');
    expect(re.test('services/api/src/main.ts')).toBe(true);
    expect(re.test('services/api/nested/deep/x.ts')).toBe(true);
    expect(re.test('services/web/src/x.ts')).toBe(false);
  });

  it('a/**/b collapses slashes so a/b matches', () => {
    const re = globToRegExp('a/**/b');
    expect(re.test('a/b')).toBe(true);
    expect(re.test('a/x/y/b')).toBe(true);
  });

  it('supports ? as a single non-slash char', () => {
    const re = globToRegExp('file?.ts');
    expect(re.test('file1.ts')).toBe(true);
    expect(re.test('file12.ts')).toBe(false);
    expect(re.test('file/.ts')).toBe(false);
  });

  it('escapes regex metacharacters in the pattern', () => {
    const re = globToRegExp('a.b+c(d)');
    expect(re.test('a.b+c(d)')).toBe(true);
    expect(re.test('aXbYcZd')).toBe(false);
  });

  it('ignores a leading slash', () => {
    expect(globToRegExp('/src/x.ts').test('src/x.ts')).toBe(true);
  });
});

describe('matchesAny', () => {
  it('returns true when any pattern matches', () => {
    expect(matchesAny('packages/lib/a.ts', ['apps/**', 'packages/**'])).toBe(true);
    expect(matchesAny('docs/readme.md', ['apps/**', 'packages/**'])).toBe(false);
  });
});

describe('parseWatchPaths', () => {
  it('drops patterns that could create pathological regex backtracking', () => {
    expect(isSafeWatchPath('**'.repeat(5))).toBe(false);
    expect(isSafeWatchPath('*'.repeat(17))).toBe(false);
    expect(parseWatchPaths('**'.repeat(5))).toEqual([]);
  });

  it('splits on newlines and commas, trimming blanks', () => {
    expect(parseWatchPaths('a/**, b/*\n\n  c  ')).toEqual(['a/**', 'b/*', 'c']);
    expect(parseWatchPaths(null)).toEqual([]);
    expect(parseWatchPaths('   ')).toEqual([]);
  });
});
