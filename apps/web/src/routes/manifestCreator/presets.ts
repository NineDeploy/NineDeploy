/**
 * Starter presets shown at the top of the Manifest Creator. Each preset
 * is a fully-populated `NinedeployManifest` plus a UI description; selecting
 * one in `PresetSelector` replaces the form state wholesale.
 *
 * The values are intentionally opinionated, but the *versions* are not
 * written here — they come from `RUNTIME_VERSION_CATALOG` in
 * `@ninedeploy/schemas`, which is the single place any runtime version is
 * maintained. Bumping a default is a one-line change in that catalog and it
 * lands here, in the CLI's `starterManifest`, and in the version picker at
 * the same time.
 */
import type { NinedeployManifest } from '@ninedeploy/schemas';
import { recommendedRuntimeVersion } from '@ninedeploy/schemas';

export interface ManifestPreset {
  id: string;
  label: string;
  description: string;
  manifest: NinedeployManifest;
}

/**
 * Read a recommended version out of the catalog. Throws rather than falling
 * back to an unpinned runtime: a preset that silently stopped pinning a
 * version would be a much subtler bug than a loud one at module load.
 */
function pin(type: 'node' | 'python' | 'go'): string {
  const version = recommendedRuntimeVersion(type);
  /* c8 ignore next -- unreachable: the catalog always carries these three. */
  if (!version) throw new Error(`runtime catalog has no recommended version for "${type}"`);
  return version;
}

const NODE_VERSION = pin('node');
const PYTHON_VERSION = pin('python');
const GO_VERSION = pin('go');

const NODE_NPM: NinedeployManifest = {
  version: '1',
  runtime: { type: 'node', version: NODE_VERSION },
  build: { install: 'npm ci', build: 'npm run build', start: 'npm start' },
  run: { port: 3000, restart: 'unless-stopped' },
};

const NODE_PNPM: NinedeployManifest = {
  version: '1',
  runtime: { type: 'node', version: NODE_VERSION },
  build: {
    install: 'pnpm install --frozen-lockfile',
    build: 'pnpm build',
    start: 'pnpm start',
  },
  run: { port: 3000, restart: 'unless-stopped' },
};

const PYTHON_PIP: NinedeployManifest = {
  version: '1',
  runtime: { type: 'python', version: PYTHON_VERSION },
  build: { install: 'pip install -r requirements.txt', start: 'python main.py' },
  run: { port: 8000, restart: 'unless-stopped' },
};

const GO: NinedeployManifest = {
  version: '1',
  runtime: { type: 'go', version: GO_VERSION },
  build: { build: 'go build -o app .', start: './app' },
  run: { port: 8080, restart: 'unless-stopped' },
};

const STATIC_VITE: NinedeployManifest = {
  version: '1',
  static: { spa: true, root: 'dist' },
  build: { install: 'npm ci', build: 'npm run build' },
  run: { port: 3000, restart: 'unless-stopped' },
};

const EMPTY: NinedeployManifest = { version: '1' };

export const PRESETS: readonly ManifestPreset[] = [
  {
    id: 'empty',
    label: 'Blank',
    description: 'Start from scratch — just the version field',
    manifest: EMPTY,
  },
  {
    id: 'node-npm',
    label: `Node ${NODE_VERSION} (npm)`,
    description: 'Active LTS Node with npm ci + npm run build',
    manifest: NODE_NPM,
  },
  {
    id: 'node-pnpm',
    label: `Node ${NODE_VERSION} (pnpm)`,
    description: 'pnpm with frozen lockfile',
    manifest: NODE_PNPM,
  },
  {
    id: 'python',
    label: `Python ${PYTHON_VERSION}`,
    description: 'pip + requirements.txt',
    manifest: PYTHON_PIP,
  },
  {
    id: 'go',
    label: `Go ${GO_VERSION}`,
    description: 'go build → ./app binary',
    manifest: GO,
  },
  {
    id: 'static',
    label: 'Static SPA (Vite)',
    description: 'Pre-built dist/ served as a static SPA',
    manifest: STATIC_VITE,
  },
] as const;
