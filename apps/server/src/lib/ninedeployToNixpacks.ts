import type { NinedeployManifest, RuntimeType } from '@ninedeploy/schemas';

/**
 * Translate a `.ninedeploy` manifest into a Nixpacks-compatible `nixpacks.toml`
 * string. The file is the single source of truth at build time: Nixpacks
 * reads it from the repo root and overrides its own auto-detection with the
 * values declared here.
 *
 * The function is pure: same input → same output, no I/O. The docker builder
 * writes the result to a temp file alongside the checked-out repo and lets
 * Nixpacks pick it up automatically.
 *
 * Field mapping:
 *   - `runtime.type`     → first matching provider package in nixPkgs
 *   - `runtime.version`  → NIXPACKS_<TYPE>_VERSION env var (when supported)
 *   - `phases.setup.pkgs` → additive nixPkgs entries
 *   - `phases.build.cmds` → [phases.build].cmds
 *   - `build.install`     → [phases.install].cmds
 *   - `build.build`       → [phases.build].cmds (prepended)
 *   - `build.start`       → [phases.start].cmd
 *
 * Returns `null` when the manifest has nothing Nixpacks can act on (i.e.
 * the auto-detected defaults would already do the right thing). The caller
 * uses that to skip writing an empty nixpacks.toml.
 */

/** Map a NineDeploy runtime type to the Nixpacks variable that pins the version. */
const NIXPACKS_VERSION_VAR: Partial<Record<RuntimeType, string>> = {
  node: 'NIXPACKS_NODE_VERSION',
  python: 'NIXPACKS_PYTHON_VERSION',
  go: 'NIXPACKS_GO_VERSION',
  ruby: 'NIXPACKS_RUBY_VERSION',
  php: 'NIXPACKS_PHP_VERSION',
  rust: 'NIXPACKS_RUST_VERSION',
};

/**
 * `runtime.type` only ever needs a package pin when it's not `auto` AND
 * `runtime.version` is set. Auto-discovery has its own provider resolution
 * (e.g. Nixpacks sees a `package.json` and picks Node on its own), so we
 * don't override unless the manifest explicitly tells us to.
 */
const NIXPACKS_PKG: Partial<Record<RuntimeType, (version: string) => string>> = {
  node: (v) => `nodejs_${v.replace(/\D/g, '')}`,
  python: (v) => `python${v.replace('.', '')}`,
  go: (v) => `go_${v.replace(/\D/g, '')}`,
  ruby: (v) => `ruby_${v.replace(/\D/g, '')}`,
  php: (v) => `php${v.replace(/\D/g, '')}`,
  rust: () => `rustc`,
};

function formatTomlString(value: string): string {
  // TOML basic strings: escape backslash and double-quote, then wrap in
  // double quotes. The values we serialize here are command lines and
  // version strings — neither contains literal newlines or non-ASCII.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatTomlArray(values: string[]): string {
  if (values.length === 0) return '[]';
  const lines = values.map((v) => `    ${formatTomlString(v)}`);
  return `[\n${lines.join(',\n')},\n  ]`;
}

export function generateNixpacksToml(manifest: NinedeployManifest): string | null {
  const sections: string[] = [];
  const variables: string[] = [];

  // ── [phases.setup] nixPkgs (additive) ───────────────────────────────────
  const setupPkgs: string[] = [];
  const runtime = manifest.runtime;
  if (runtime?.type && runtime.type !== 'auto' && runtime.version) {
    const pkg = NIXPACKS_PKG[runtime.type]?.(runtime.version);
    if (pkg) setupPkgs.push(pkg);
  }
  for (const pkg of manifest.phases?.setup?.pkgs ?? []) {
    setupPkgs.push(pkg);
  }
  if (setupPkgs.length > 0) {
    sections.push(`[phases.setup]\nnixPkgs = ${formatTomlArray(setupPkgs)}`);
  }

  // ── [phases.install] (manifest.build.install) ──────────────────────────
  const installCmds: string[] = [];
  if (manifest.build?.install) installCmds.push(manifest.build.install);
  if (installCmds.length > 0) {
    sections.push(`[phases.install]\ncmds = ${formatTomlArray(installCmds)}`);
  }

  // ── [phases.build] (manifest.build.build + manifest.phases.build.cmds) ─
  const buildCmds: string[] = [];
  if (manifest.build?.build) buildCmds.push(manifest.build.build);
  for (const cmd of manifest.phases?.build?.cmds ?? []) {
    buildCmds.push(cmd);
  }
  if (buildCmds.length > 0) {
    sections.push(`[phases.build]\ncmds = ${formatTomlArray(buildCmds)}`);
  }

  // ── [phases.start] (manifest.build.start) ──────────────────────────────
  if (manifest.build?.start) {
    sections.push(`[phases.start]\ncmd = ${formatTomlString(manifest.build.start)}`);
  }

  // ── [variables] (NIXPACKS_<TYPE>_VERSION) ──────────────────────────────
  if (runtime?.type && runtime.type !== 'auto' && runtime.version) {
    const envVar = NIXPACKS_VERSION_VAR[runtime.type];
    if (envVar) {
      variables.push(`${envVar} = ${formatTomlString(runtime.version)}`);
    }
  }
  if (variables.length > 0) {
    sections.push(`[variables]\n${variables.join('\n')}`);
  }

  if (sections.length === 0) return null;
  // Two blank lines between sections is the Nixpacks-recommended style.
  return `${sections.join('\n\n')}\n`;
}
