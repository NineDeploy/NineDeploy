/**
 * Template registry — data-driven, not hardcoded.
 *
 * The hub loads its templates from a JSON "registry bundle" whose shape is
 * validated against the shared zod schema (`template` in @ninedeploy/schemas):
 *
 *   { "version": 1, "updated": "<date>", "templates": [ { id, name, tagline,
 *     description, category, emoji, image, port, volumeMount?, env?, website?,
 *     docs?, featured? }, … ] }
 *
 * Source resolution (first match wins):
 *   1. The `templates_source` instance setting (Settings → Hub) — either an
 *      https URL to a registry bundle or an absolute local path to one.
 *   2. The `NINEDEPLOY_TEMPLATES_SOURCE` env var (same format).
 *   3. The bundled registry at src/templates/registry.json (this repo).
 *
 * Remote bundles are fetched with a timeout and CACHED to
 * `<dataDir>/templates-cache.json`; when a refresh fails the cache serves as
 * the fallback, and finally the bundled registry keeps the hub working offline.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { template as templateSchema, type Template } from '@ninedeploy/schemas';
import { config } from '../config.js';
import type { DB } from '@ninedeploy/db';
import { getSettingString } from '../lib/settings.js';

/** The bundled registry — ships with the app, guarantees an offline fallback. */
import bundled from './registry.json' with { type: 'json' };

export type { Template };

/** A registry bundle: a versioned envelope around the template array. */
export interface RegistryBundle {
  version: number;
  updated?: string;
  templates: unknown;
}

export const BUNDLED_REGISTRY = bundled as RegistryBundle;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // refresh remote registries every 6h
const FETCH_TIMEOUT_MS = 10_000;
const cachePath = () => path.join(config.paths.dataDir, 'templates-cache.json');

/** Validate a template array; throws with a precise message on schema drift. */
export function parseTemplates(raw: unknown): Template[] {
  const result = templateSchema.array().safeParse(raw);
  if (!result.success) {
    // zod guarantees at least one issue on failure.
    const issue = result.error.issues[0]!;
    throw new Error(`Invalid registry bundle: template ${issue.path.join('.')} ${issue.message}`);
  }
  return result.data;
}

/** Validate a parsed bundle envelope; throws with a precise message on drift. */
export function parseBundle(raw: unknown): Template[] {
  const bundle = raw as RegistryBundle;
  if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.templates)) {
    throw new Error('Invalid registry bundle: expected { version, templates: [...] }');
  }
  return parseTemplates(bundle.templates);
}

/** The bundled registry, validated lazily once (bad builds fail loudly). */
let bundledTemplates: Template[] | null = null;
function bundledList(): Template[] {
  bundledTemplates ??= parseBundle(BUNDLED_REGISTRY);
  return bundledTemplates;
}

/** In-memory cache: one successful load per source string. */
const memo = new Map<string, Template[]>();

/** Drop cached registries (after a source change, and in tests). */
export function invalidateTemplateCache(): void {
  memo.clear();
}

const readBundleFile = (file: string): Template[] => parseBundle(JSON.parse(readFileSync(file, 'utf8')));

/** Fetch a remote bundle, cache it to the data dir, and return its templates. */
async function fetchRemote(source: string): Promise<Template[]> {
  const res = await fetch(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Registry fetch failed (${res.status})`);
  const templates = parseBundle(await res.json());
  try {
    writeFileSync(cachePath(), JSON.stringify({ source, fetchedAt: new Date().toISOString(), templates } satisfies {
      source: string; fetchedAt: string; templates: Template[];
    }, null, 2));
  } catch {
    /* a cache write failure must never break the hub */
  }
  return templates;
}

/** Read the cached remote bundle if it is fresh enough. */
function freshCache(source: string): Template[] | null {
  try {
    if (!existsSync(cachePath())) return null;
    const cached = JSON.parse(readFileSync(cachePath(), 'utf8')) as { source?: string; fetchedAt?: string; templates?: unknown };
    if (cached.source !== source || !cached.fetchedAt) return null;
    if (Date.now() - new Date(cached.fetchedAt).getTime() > CACHE_TTL_MS) return null;
    return parseTemplates(cached.templates);
  } catch {
    return null;
  }
}

/**
 * Load the template list for the configured source with the full fallback
 * chain: configured source → disk cache → bundled registry.
 */
export async function getTemplates(db: DB | null): Promise<Template[]> {
  let source: string | null = null;
  if (db) {
    try {
      source = await getSettingString(db, 'templates_source', null);
    } catch {
      source = null; // settings table might not exist yet (first boot)
    }
  }
  source ??= config.templatesSource ?? null;
  if (!source) return bundledList();

  const memoized = memo.get(source);
  if (memoized) return memoized;

  let templates: Template[];
  try {
    if (/^https?:\/\//i.test(source)) {
      templates = (await freshCache(source)) ?? (await fetchRemote(source));
    } else {
      templates = readBundleFile(source);
    }
  } catch {
    // Source failed → stale cache is better than nothing → bundled is guaranteed.
    try {
      const stale = JSON.parse(readFileSync(cachePath(), 'utf8')) as { source?: string; templates?: unknown };
      if (stale.source === source && stale.templates) {
        templates = parseTemplates(stale.templates);
      } else {
        throw new Error('cache miss');
      }
    } catch {
      templates = bundledList();
    }
  }
  memo.set(source, templates);
  return templates;
}
