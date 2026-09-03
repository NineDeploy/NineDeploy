import { describe, expect, it } from 'vitest';
import { createProject, createService, slug, updateService } from '@ninedeploy/schemas';
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

  // r028 regression: truncation ran AFTER the leading/trailing-dash strip, so a
  // name whose 63rd character is a separator stranded it there. Callers store
  // the result unvalidated (modules/services.ts, modules/databases.ts) and reuse
  // it as the nd-svc-<slug> / nd-db-<slug> container name and bridge DNS label,
  // and a DNS label may not end with '-'.
  describe('output satisfies the canonical slug contract (r028)', () => {
    const LONG = [
      'Customer Data Platform Integration Service - staging environment alpha',
      `${'a'.repeat(62)}- b`,
      `${'x'.repeat(62)} y z`,
      'nightly reconciliation job runner for the accounting ledger - v2',
      `${'q'.repeat(63)}----`,
      `${'w'.repeat(60)} and more words here`,
    ];

    it('never strands a trailing hyphen when the name truncates at 63', () => {
      for (const name of LONG) {
        const out = slugify(name);
        expect(out.endsWith('-'), `slugify(${JSON.stringify(name)}) = ${JSON.stringify(out)}`).toBe(false);
      }
    });

    it('emits a slug the canonical @ninedeploy/schemas slug validator accepts', () => {
      for (const name of LONG) {
        const out = slugify(name);
        expect(slug.safeParse(out).success, `slug schema rejected ${JSON.stringify(out)}`).toBe(true);
      }
    });

    it('keeps the 63-char cap and the documented exact values', () => {
      // The cap itself must not regress for input that truncates cleanly.
      expect(slugify('a'.repeat(100))).toBe('a'.repeat(63));
      expect(slugify('a'.repeat(100))).toHaveLength(63);
      // Boundary: exactly 63 usable characters are preserved verbatim.
      expect(slugify('b'.repeat(63))).toBe('b'.repeat(63));
      // A dash run beyond the cap is dropped with the cut, not left behind.
      expect(slugify(`${'q'.repeat(63)}----`)).toBe('q'.repeat(63));
      // Short/unchanged behaviour is untouched by the reordering.
      expect(slugify('  My App  ')).toBe('my-app');
    });
  });

  // r029 regression: the canonical `slug` contract requires 2..63 characters,
  // but createService/createDatabase take `name` at min(1) and the routes
  // persist `slugify(input.name)` WITHOUT re-validating it (modules/services.ts
  // :228 and :693, modules/databases.ts:138, modules/projects.ts:84). A
  // one-character name therefore produced a slug the server's own
  // updateService/createProject schema rejects, and 'a!' collapses to 'a' even
  // though createProject.name is min(2) — which is why the guard lives in the
  // generator and not as a larger input minimum.
  describe('output meets the canonical minimum length (r029)', () => {
    it('pads a one-character slug so it satisfies the 2-char minimum', () => {
      expect(slugify('a')).toBe('aa');
      expect(slugify('7')).toBe('77');
      // The collapse case: two characters in, one usable character out.
      expect(slugify('a!')).toBe('aa');
    });

    it('accepts a createService name and returns a slug updateService accepts', () => {
      for (const name of ['a', 'x', '7', 'a!']) {
        // The route only runs if the payload validates...
        expect(createService.safeParse({ name, type: 'docker' }).success, `name ${name} rejected`).toBe(true);
        // ...so the slug it derives must validate on the same column.
        const derived = slugify(name);
        const back = updateService.safeParse({ slug: derived });
        expect(back.success, `updateService rejected server-derived slug ${derived}`).toBe(true);
      }
    });

    it('keeps createProject self-consistent for a two-character name that slugs to one', () => {
      const name = 'a!';
      expect(createProject.safeParse({ name }).success).toBe(true);
      const derived = slugify(name);
      expect(createProject.safeParse({ name, slug: derived }).success).toBe(true);
      expect(slug.safeParse(derived).success).toBe(true);
    });

    it('padding introduces no collisions and stays idempotent', () => {
      const short = ['a', 'b', 'z', '0', '9'];
      const out = short.map((n) => slugify(n));
      // Distinct names must not collapse onto one another, or two services
      // would fight over the same nd-svc-<slug> bridge.
      expect(new Set(out).size).toBe(short.length);
      for (const s of out) {
        expect(s, `slug ${s} is not a legal DNS label`).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
        // Re-slugging stored data (clone/rename paths) must not drift again.
        expect(slugify(s)).toBe(s);
      }
    });

    it('still falls back to "service" when nothing usable survives', () => {
      // Length 1 is padded; length 0 keeps the pre-existing sentinel.
      expect(slugify('')).toBe('service');
      expect(slugify('!!!')).toBe('service');
      expect(slugify('   ')).toBe('service');
    });
  });
});
