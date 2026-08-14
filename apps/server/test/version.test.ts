import { describe, expect, it } from 'vitest';
import { ABOUT, CHANGELOG, VERSION } from '../src/version.js';

describe('version', () => {
  it('ABOUT exposes the expected identity fields', () => {
    expect(ABOUT.name).toBe('NineDeploy');
    expect(ABOUT.version).toBe(VERSION);
    expect(ABOUT.description).toContain('Self-hosted deployment platform');
    expect(ABOUT.license).toBe('MIT');
    expect(ABOUT.repo).toMatch(/^https:\/\/github\.com\//);
    expect(ABOUT.docs).toMatch(/^https:\/\//);
  });

  it('ABOUT lists a tech stack with category/item pairs', () => {
    expect(ABOUT.techStack.length).toBeGreaterThan(0);
    for (const entry of ABOUT.techStack) {
      expect(typeof entry.category).toBe('string');
      expect(Array.isArray(entry.items)).toBe(true);
      expect(entry.items.length).toBeGreaterThan(0);
    }
  });

  it('ABOUT links to the changelog and the current release entry', () => {
    expect(ABOUT.changelog).toBe(CHANGELOG);
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0]?.version).toBe(VERSION);
    expect(CHANGELOG[0]?.title).toBe('Initial pre-release');
    expect(CHANGELOG[0]?.changes.length).toBeGreaterThan(0);
  });

  it('VERSION is a semver-shaped string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
