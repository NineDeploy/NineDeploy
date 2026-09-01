/**
 * Minimal glob → RegExp conversion for webhook watch paths.
 * Supported syntax: `*` (any chars except `/`), `**` (any chars incl. `/`),
 * `?` (single char). Patterns match relative paths; a leading `/` is stripped.
 * No regex metacharacters in the pattern are honored (they are escaped).
 */

export function globToRegExp(pattern: string): RegExp {
  const src = pattern.replace(/^\/+/, '');
  let re = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '*') {
      if (src[i + 1] === '*') {
        // `**` — match across path separators. Consume a following slash so
        // `a/**/b` also matches `a/b`.
        re += '(?:.*)';
        i += 2;
        if (src[i] === '/') i += 1;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^(?:${re})$`);
}

/** Keep user-supplied globs within a linear, bounded matching budget. */
export function isSafeWatchPath(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 256) return false;
  const deepStars = (pattern.match(/\*\*/g) ?? []).length;
  const wildcards = (pattern.match(/[?*]/g) ?? []).length;
  return deepStars <= 4 && wildcards <= 16;
}

/** True when `path` matches ANY of the glob patterns. */
export function matchesAny(path: string, patterns: string[]): boolean {
  const clean = path.replace(/^\/+/, '');
  return patterns.some((p) => isSafeWatchPath(p) && globToRegExp(p).test(clean));
}

/** Split a raw watchPaths field (newline or comma separated) into patterns. */
export function parseWatchPaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(isSafeWatchPath)
    .slice(0, 32);
}
