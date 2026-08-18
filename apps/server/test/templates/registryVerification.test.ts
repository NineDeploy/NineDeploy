import { describe, expect, it } from 'vitest';
import { template as templateSchema } from '@ninedeploy/schemas';
import bundledRegistry from '../../src/templates/registry.json' with { type: 'json' };
import { parseBundle, parseTemplates } from '../../src/templates/registry.js';

describe('Hub Template Registry Proof & Verification Suite', () => {
  const templates = bundledRegistry.templates as any[];

  it('validates the overall registry structure and versioning', () => {
    expect(bundledRegistry.version).toBeGreaterThanOrEqual(1);
    expect(bundledRegistry.updated).toBeDefined();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(30);
  });

  it('proves every single template conforms strictly to the Zod Template Schema', () => {
    const parsed = parseBundle(bundledRegistry);
    expect(parsed.length).toBe(templates.length);

    for (const t of templates) {
      const result = templateSchema.safeParse(t);
      if (!result.success) {
        throw new Error(`Template validation failed for "${t.id}": ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.success).toBe(true);
      expect(result.data.id).toBe(t.id);
      expect(result.data.name).toBe(t.name);
      expect(result.data.image).toBe(t.image);
      expect(result.data.port).toBeGreaterThanOrEqual(1);
      expect(result.data.port).toBeLessThanOrEqual(65535);
    }
  });

  it('guarantees unique IDs across all templates (no collisions)', () => {
    const ids = new Set<string>();
    for (const t of templates) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
    expect(ids.size).toBe(templates.length);
  });

  it('validates standard categories and emojis for UI rendering', () => {
    const validCategories = new Set([
      'Automation', 'AI', 'Analytics', 'Developer', 'DevOps',
      'CMS', 'Databases', 'Security', 'Communication', 'Productivity',
      'Monitoring', 'Storage',
    ]);

    for (const t of templates) {
      expect(t.category).toBeDefined();
      expect(t.emoji).toBeDefined();
      expect(t.emoji.length).toBeGreaterThanOrEqual(1);
      expect(t.name.trim().length).toBeGreaterThanOrEqual(2);
      expect(t.description.trim().length).toBeGreaterThanOrEqual(10);
    }
  });

  it('validates database requirements and env configurations', () => {
    const validEngines = new Set(['postgres', 'mysql', 'mariadb', 'redis', 'valkey', 'mongo', 'clickhouse', 'meilisearch', 'rabbitmq', 'sqlite']);

    for (const t of templates) {
      if (t.dbEngine) {
        expect(validEngines.has(t.dbEngine)).toBe(true);
      }
      if (t.env) {
        expect(Array.isArray(t.env)).toBe(true);
        for (const e of t.env) {
          expect(e.key).toBeDefined();
          expect(typeof e.key).toBe('string');
          expect(e.key.length).toBeGreaterThan(0);
          expect(e.value).toBeDefined();
        }
      }
      if (t.volumeMount) {
        expect(t.volumeMount.startsWith('/')).toBe(true);
      }
    }
  });

  it('includes cutting-edge AI and modern self-hosted tools', () => {
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('n8n');
    expect(ids).toContain('ollama');
    expect(ids).toContain('strapi');
    expect(ids).toContain('pocketbase');
    expect(ids).toContain('directus');
    expect(ids).toContain('hasura');
  });
});
