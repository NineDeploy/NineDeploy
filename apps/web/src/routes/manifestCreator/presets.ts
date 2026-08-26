/**
 * Starter presets shown at the top of the Manifest Creator. Each preset
 * is a fully-populated `NinedeployManifest` plus a UI description; selecting
 * one in `PresetSelector` replaces the form state wholesale.
 *
 * The values are intentionally opinionated: they pin current LTS versions
 * (Node 20, Python 3.12) and use the manifest itself to declare the
 * host routes, so the operator only edits what is project-specific.
 */
import type { NinedeployManifest } from '@ninedeploy/schemas';

export interface ManifestPreset {
  id: string;
  label: string;
  description: string;
  manifest: NinedeployManifest;
}

const NODE_NPM: NinedeployManifest = {
  version: '1',
  runtime: { type: 'node', version: '20' },
  build: { install: 'npm ci', build: 'npm run build', start: 'npm start' },
  run: { port: 3000, restart: 'unless-stopped' },
};

const NODE_PNPM: NinedeployManifest = {
  version: '1',
  runtime: { type: 'node', version: '20' },
  build: {
    install: 'pnpm install --frozen-lockfile',
    build: 'pnpm build',
    start: 'pnpm start',
  },
  run: { port: 3000, restart: 'unless-stopped' },
};

const PYTHON_PIP: NinedeployManifest = {
  version: '1',
  runtime: { type: 'python', version: '3.12' },
  build: { install: 'pip install -r requirements.txt', start: 'python main.py' },
  run: { port: 8000, restart: 'unless-stopped' },
};

const GO: NinedeployManifest = {
  version: '1',
  runtime: { type: 'go', version: '1.22' },
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
    label: 'Node 20 (npm)',
    description: 'LTS Node with npm ci + npm run build',
    manifest: NODE_NPM,
  },
  {
    id: 'node-pnpm',
    label: 'Node 20 (pnpm)',
    description: 'pnpm with frozen lockfile',
    manifest: NODE_PNPM,
  },
  {
    id: 'python',
    label: 'Python 3.12',
    description: 'pip + requirements.txt',
    manifest: PYTHON_PIP,
  },
  {
    id: 'go',
    label: 'Go 1.22',
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
