import path from 'node:path';

/**
 * Re-anchor a build-config path onto the checked-out repository.
 *
 * `baseDir` and `dockerfilePath` are user-supplied and the UI's convention is
 * that a leading slash means "from the repo root" — but `path.resolve()` reads
 * a leading slash as the FILESYSTEM root and discards everything before it:
 *
 *     path.resolve('/data/repos/42', '/etc', 'Dockerfile')  →  '/etc/Dockerfile'
 *
 * so `baseDir: "/etc"` turned the host's /etc into the docker build context.
 * Stripping the leading separators makes the resolve behave the way the field
 * is documented, and the containment check below catches anything else that
 * still escapes (symlink-free `..` was already rejected at the schema layer;
 * this is the sink defending itself).
 */
export function resolveInRepo(workDir: string, ...segments: Array<string | undefined>): string {
  const cleaned = segments
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim().replace(/^[/\\]+/, ''));
  const resolved = path.resolve(workDir, ...cleaned);
  const root = path.resolve(workDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to use a build path outside the repository: ${segments.join('/')}`);
  }
  return resolved;
}

/**
 * The repo-relative form of a build path, for the places that must hand docker
 * a path RELATIVE to the work dir (the build context operand, `compose -f`).
 * Returns '.' for the repo root so it is always a usable operand.
 */
export function repoRelative(workDir: string, value: string | undefined): string {
  if (!value || value.trim() === '' || /^[/\\]+$/.test(value.trim())) return '.';
  const rel = path.relative(path.resolve(workDir), resolveInRepo(workDir, value));
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}
