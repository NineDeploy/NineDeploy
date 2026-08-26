import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  type NinedeployManifest,
  NINEDEPLOY_MANIFEST_FILENAMES,
  NINEDEPLOY_MANIFEST_MAX_BYTES,
  ninedeployManifest,
  hasSecret,
  type SecretHit,
  scanForSecrets,
} from '@ninedeploy/schemas';
import { isENOENT } from './fsErrors.js';

/**
 * The `.ninedeploy` loader.
 *
 * Three layers of defence before a manifest is accepted:
 *   1. Size cap (16 KB) — large files are abusive or accidental.
 *   2. Secret scan on the raw YAML — refuses AKIA, ghp_, glpat-, etc. before
 *      the parser even runs, so a real credential never gets logged.
 *   3. Zod validation — schema is the source of truth, not the parser.
 *
 * The loader is intentionally small: it produces a parsed object and a path,
 * nothing more. "Apply to a build config", "generate nixpacks.toml",
 * "merge into service config" live in separate helpers so each can be
 * tested in isolation and so a future change in the apply logic does not
 * touch the parse path.
 */

/** Where a manifest was found, plus the parsed payload. */
export interface LoadedManifest {
  /** Absolute path of the file that was loaded. */
  filePath: string;
  /** Repo-relative POSIX form of the same path. */
  relativePath: string;
  manifest: NinedeployManifest;
  /** Secret-pattern hits discovered in the raw file contents. Always empty on
   *  success — the loader refuses to return a manifest when hits exist. */
  rawSecretHits: SecretHit[];
}

/** Thrown when the manifest file exists but is larger than the size cap. */
export class ManifestTooLargeError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly sizeBytes: number,
  ) {
    super(
      `.ninedeploy at ${filePath} is ${sizeBytes} bytes; the maximum allowed is ${NINEDEPLOY_MANIFEST_MAX_BYTES} bytes`,
    );
    this.name = 'ManifestTooLargeError';
  }
}

/** Thrown when the raw manifest text matches a known secret pattern. */
export class ManifestSecretError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly hits: SecretHit[],
  ) {
    const summary = hits
      .map((h) => `${h.patternId} (${h.redacted})`)
      .join(', ');
    super(
      `.ninedeploy at ${filePath} contains values that look like secrets: ${summary}. ` +
        'Move them to the panel env vault; this file is committed to the repo.',
    );
    this.name = 'ManifestSecretError';
  }
}

/** Thrown when the YAML is malformed. */
export class ManifestParseError extends Error {
  constructor(
    public readonly filePath: string,
    public override readonly cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`.ninedeploy at ${filePath} is not valid YAML: ${reason}`);
    this.name = 'ManifestParseError';
  }
}

/** Thrown when the parsed document does not match the schema. */
export class ManifestValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly issues: ReadonlyArray<{ path: string; message: string }>,
  ) {
    const detail = issues
      .map((i) => `  - ${i.path || '<root>'}: ${i.message}`)
      .join('\n');
    super(`.ninedeploy at ${filePath} failed schema validation:\n${detail}`);
    this.name = 'ManifestValidationError';
  }
}

/**
 * Find the first manifest filename that exists in `workDir`. Returns the
 * absolute path or `null` when none is present. The priority order is the
 * one documented in `NINEDEPLOY_MANIFEST_FILENAMES`; a single repo with two
 * files (e.g. both `.ninedeploy` and `.ninedeploy.yml`) takes the first.
 */
export function findManifestPath(workDir: string): string | null {
  for (const filename of NINEDEPLOY_MANIFEST_FILENAMES) {
    const candidate = path.join(workDir, filename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Parse a raw `.ninedeploy` YAML string into a typed object.
 *
 * Throws:
 *   - `ManifestParseError` when the YAML is malformed.
 *   - `ManifestValidationError` when the parsed document fails Zod.
 *
 * Does NOT scan for secrets — callers that load from disk must run the
 * secret scan on the raw text BEFORE this is called, so the values are
 * never logged.
 */
export function parseNinedeployManifest(yamlText: string, filePath = '<string>'): NinedeployManifest {
  let doc: unknown;
  try {
    doc = yaml.load(yamlText, { filename: filePath });
  } catch (err) {
    throw new ManifestParseError(filePath, err);
  }
  if (doc == null) {
    throw new ManifestValidationError(filePath, [
      { path: '', message: 'manifest is empty' },
    ]);
  }
  const result = ninedeployManifest.safeParse(doc);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new ManifestValidationError(filePath, issues);
  }
  return result.data;
}

/**
 * Read, scan and parse the manifest in `workDir`. Returns `null` when no
 * manifest file is present — a missing manifest is not an error, the build
 * continues with auto-detected defaults.
 *
 * Throws on size cap, secret hit, parse error, or schema mismatch.
 */
export function loadNinedeployManifest(workDir: string): LoadedManifest | null {
  const filePath = findManifestPath(workDir);
  if (!filePath) return null;

  // readFileSync (not async): the file is small (16 KB cap) and we want a
  // synchronous read so the rest of the function stays linear and testable.
  // Treat ENOENT as "no manifest" — there is a TOCTOU window between
  // `existsSync` (used by `findManifestPath`) and the open syscall here, and
  // a deleted/renamed manifest in that gap is a no-op for the build, not a
  // failure. Any other read error propagates so a real I/O issue surfaces.
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
  if (buf.byteLength > NINEDEPLOY_MANIFEST_MAX_BYTES) {
    throw new ManifestTooLargeError(filePath, buf.byteLength);
  }
  const text = buf.toString('utf8');

  const rawSecretHits = scanForSecrets(text);
  if (rawSecretHits.length > 0) {
    throw new ManifestSecretError(filePath, rawSecretHits);
  }

  const manifest = parseNinedeployManifest(text, filePath);
  const relativePath = path.relative(workDir, filePath).split(path.sep).join('/');
  return { filePath, relativePath, manifest, rawSecretHits: [] };
}

/**
 * Cheap boolean variant — used by the build pipeline to decide whether to
 * log a "manifest loaded" line without paying the cost of a Zod parse.
 * Returns `false` for "no manifest" AND for "manifest exists but the secret
 * scan / parse / validation failed" — the caller is expected to invoke
 * `loadNinedeployManifest` separately and surface those errors.
 */
export function hasNinedeployManifest(workDir: string): boolean {
  return findManifestPath(workDir) !== null;
}

/** Re-export so callers do not have to import both modules. */
export { hasSecret, scanForSecrets, type SecretHit };
