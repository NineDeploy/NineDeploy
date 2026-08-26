import type { BuildConfig } from '@ninedeploy/db';
import type { NinedeployManifest } from '@ninedeploy/schemas';

/**
 * Apply a `.ninedeploy` manifest onto an existing `BuildConfig`.
 *
 * Merge rule: **panel/DB > manifest > auto-detect**. Every manifest field is
 * applied only when the matching `BuildConfig` field is null/undefined — a
 * value the operator already set in the panel is never overwritten by the
 * repo. This keeps the panel authoritative while letting the manifest fill
 * in the gaps for the 95% of services where the panel is left empty.
 *
 * What is NOT patched here: runtime/phases/start (they are expressed
 * through the generated `nixpacks.toml` instead), `env.required` (handled
 * by the build log as a warning), and `routes`/`database`/`volume`/etc.
 * (routed through their own modules, see PR 3).
 */
export function applyManifestToBuildConfig(
  manifest: NinedeployManifest,
  buildConfig: BuildConfig,
): BuildConfig {
  return {
    ...buildConfig,
    installCmd: buildConfig.installCmd ?? manifest.build?.install ?? null,
    buildCmd: buildConfig.buildCmd ?? manifest.build?.build ?? null,
    startCmd: buildConfig.startCmd ?? manifest.build?.start ?? null,
    // baseDir in the DB is a non-null string with default '/'; treat '/' as
    // "operator did not customise" so a manifest value can still win.
    baseDir: isUnsetBaseDir(buildConfig.baseDir)
      ? (manifest.build?.baseDir ?? buildConfig.baseDir)
      : buildConfig.baseDir,
    dockerfilePath: buildConfig.dockerfilePath ?? manifest.build?.dockerfile ?? null,
  };
}

/**
 * Returns true when the baseDir holds the panel default and the manifest is
 * allowed to override. The DB schema sets `baseDir` to `'/'` by default, so
 * a strict `!== null` check would never trigger. Anything else (a real
 * sub-directory, an empty string set by accident) is treated as deliberate.
 */
function isUnsetBaseDir(value: string): boolean {
  return value === '/' || value === '';
}

/**
 * Validate that every `env.required` key the manifest declares is also
 * present in the runtime env map. Returns the list of missing keys so the
 * build log can warn the operator. Pure function — the caller decides
 * whether missing keys should fail the build or just log.
 */
export function findMissingRequiredEnv(
  manifest: NinedeployManifest,
  env: Record<string, string>,
): string[] {
  const required = manifest.env?.required ?? [];
  return required.filter((key) => !(key in env));
}
