import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/lib/slug.js';

describe('slugify', () => {
  it('lowercases and trims input', () => {
    expect(slugify('  My App  ')).toBe('my-app');
  });

  it('replaces runs of non-alphanumeric characters with a single dash', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('a--b__c')).toBe('a-b-c');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('--leading--')).toBe('leading');
    expect(slugify('---trailing---')).toBe('trailing');
  });

  it('caps at 63 characters', () => {
    expect(slugify('a'.repeat(100))).toHaveLength(63);
  });

  it('falls back to "service" for input that slugs to nothing', () => {
    expect(slugify('')).toBe('service');
    expect(slugify('!!!')).toBe('service');
    expect(slugify('   ')).toBe('service');
  });
});
