import { config } from '../config.js';
import { VERSION } from '../version.js';

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  updateAvailable: boolean | null; // null = unknown (offline / disabled)
  notesUrl: string | null;
  checkedAt: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — same policy as the template registry
const FETCH_TIMEOUT_MS = 10_000;

let cached: UpdateCheckResult | null = null;

/** Compare two semver strings ("v" prefix optional). Returns true when a > b. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [aMaj = 0, aMin = 0, aPatch = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPatch = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

function unknown(checkedAt = new Date().toISOString()): UpdateCheckResult {
  return { current: VERSION, latest: null, updateAvailable: null, notesUrl: null, checkedAt };
}

/**
 * Fetch the latest release tag from the configured update feed (GitHub
 * Releases format) and compare it with the running version. Results are
 * cached for 6 hours; network failures return an "unknown" result instead of
 * throwing so the dashboard never breaks on an air-gapped host.
 */
export async function checkForUpdate(force = false): Promise<UpdateCheckResult> {
  if (!force && cached && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) {
    return cached;
  }
  if (config.updateCheckUrl === 'disabled') {
    cached = unknown();
    return cached;
  }

  let result: UpdateCheckResult;
  try {
    const res = await fetch(config.updateCheckUrl, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`update feed ${res.status}`);
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const latest = typeof body.tag_name === 'string' ? body.tag_name : null;
    if (!latest) throw new Error('update feed returned no tag_name');
    result = {
      current: VERSION,
      latest,
      updateAvailable: isNewer(latest, VERSION),
      notesUrl: typeof body.html_url === 'string' ? body.html_url : null,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    result = unknown();
  }
  cached = result;
  return result;
}
