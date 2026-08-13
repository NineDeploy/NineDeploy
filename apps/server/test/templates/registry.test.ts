import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATEGORIES, TEMPLATES } from '../../src/templates/registry.js';

describe('template registry', () => {
  it('lists a non-empty template collection', () => {
    expect(TEMPLATES.length).toBeGreaterThan(10);
  });

  it('every template has the required fields and a unique id', () => {
    const ids = new Set<string>();
    for (const t of TEMPLATES) {
      expect(typeof t.id).toBe('string');
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.name).toBe('string');
      expect(typeof t.tagline).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.category).toBe('string');
      expect(typeof t.emoji).toBe('string');
      expect(typeof t.image).toBe('string');
      expect(Number.isInteger(t.port)).toBe(true);
      expect(t.port).toBeGreaterThan(0);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it('known templates are present by id', () => {
    const byId = new Map(TEMPLATES.map((t) => [t.id, t]));
    expect(byId.get('n8n')?.name).toBe('n8n');
    expect(byId.get('jellyfin')?.category).toBe('Media');
    expect(byId.get('ollama')?.featured).toBe(true);
    expect(byId.get('grafana')?.env?.some((e) => e.key === 'GF_SECURITY_ADMIN_PASSWORD')).toBe(true);
  });

  it('TEMPLATE_CATEGORIES starts with All and covers every template category', () => {
    expect(TEMPLATE_CATEGORIES[0]).toBe('All');
    const categories = new Set(TEMPLATES.map((t) => t.category));
    for (const c of categories) {
      expect(TEMPLATE_CATEGORIES).toContain(c);
    }
    expect(TEMPLATE_CATEGORIES).toHaveLength(categories.size + 1);
  });
});
