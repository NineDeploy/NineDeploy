import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyManifestToBuildConfig, findMissingRequiredEnv } from '../../src/lib/ninedeployApply.js';
import { loadNinedeployManifest } from '../../src/lib/ninedeployManifest.js';
import { generateNixpacksToml } from '../../src/lib/ninedeployToNixpacks.js';
import type { BuildConfig } from '@ninedeploy/db';

/**
 * End-to-end test of the manifest â†’ build pipeline that the docker builder
 * will use in production. Stands in for an integration test of the builder
 * itself, which would require mocking every docker call; this exercises
 * the same chain at module boundaries, with real filesystem I/O.
 */
describe('manifest chain (load â†’ apply â†’ toml)', () => {
  let workDir: string;
  const baseConfig: BuildConfig = {
    id: 1,
    serviceId: 1,
    buildPack: 'nixpacks',
    baseDir: '/',
    installCmd: null,
    buildCmd: null,
    startCmd: null,
    dockerfilePath: null,
    preDeployCmd: null,
    postDeployCmd: null,
    preStopCmd: null,
    restartPolicy: 'unless-stopped',
    stopGraceSeconds: 5,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'nd-chain-'));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('pins Node 20 end-to-end and writes a Nixpacks-compatible nixpacks.toml', () => {
    writeFileSync(
      path.join(workDir, '.ninedeploy'),
      `version: "1"
runtime:
  type: node
  version: "20"
build:
  install: npm ci
  build: npm run build
  start: node server.js
`,
    );

    // Step 1: load the manifest.
    const loaded = loadNinedeployManifest(workDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.manifest.runtime?.type).toBe('node');
    expect(loaded!.manifest.runtime?.version).toBe('20');

    // Step 2: apply to the build config.
    const effective = applyManifestToBuildConfig(loaded!.manifest, baseConfig);
    expect(effective.installCmd).toBe('npm ci');
    expect(effective.buildCmd).toBe('npm run build');
    expect(effective.startCmd).toBe('node server.js');

    // Step 3: write nixpacks.toml the way the docker builder will.
    const toml = generateNixpacksToml(loaded!.manifest);
    expect(toml).not.toBeNull();
    const tomlPath = path.join(workDir, 'nixpacks.toml');
    writeFileSync(tomlPath, toml!);
    const onDisk = readFileSync(tomlPath, 'utf8');

    // Step 4: assert the on-disk nixpacks.toml matches the Nixpacks schema.
    expect(onDisk).toContain('[phases.setup]');
    expect(onDisk).toContain('"nodejs_20"');
    expect(onDisk).toContain('[phases.install]');
    expect(onDisk).toContain('"npm ci"');
    expect(onDisk).toContain('[phases.build]');
    expect(onDisk).toContain('"npm run build"');
    expect(onDisk).toContain('[phases.start]');
    expect(onDisk).toContain('"node server.js"');
    expect(onDisk).toContain('[variables]');
    expect(onDisk).toContain('NIXPACKS_NODE_VERSION = "20"');
  });

  it('honors the panel > manifest > auto-detect merge precedence', () => {
    writeFileSync(
      path.join(workDir, '.ninedeploy'),
      `version: "1"
build:
  install: npm ci
  build: npm run build
  start: node server.js
`,
    );
    const loaded = loadNinedeployManifest(workDir);

    // Panel already has pnpm install and a custom baseDir.
    const panelOverride: BuildConfig = {
      ...baseConfig,
      installCmd: 'pnpm install --frozen-lockfile',
      baseDir: 'apps/admin',
    };

    const effective = applyManifestToBuildConfig(loaded!.manifest, panelOverride);
    // installCmd is set in the panel â†’ manifest must NOT overwrite.
    expect(effective.installCmd).toBe('pnpm install --frozen-lockfile');
    // build/start are NOT set in the panel â†’ manifest fills them.
    expect(effective.buildCmd).toBe('npm run build');
    expect(effective.startCmd).toBe('node server.js');
    // baseDir is a real sub-path in the panel â†’ manifest must NOT overwrite.
    expect(effective.baseDir).toBe('apps/admin');
  });

  it('warns about missing required env keys before the build runs', () => {
    writeFileSync(
      path.join(workDir, '.ninedeploy'),
      `version: "1"
env:
  required:
    - DATABASE_URL
    - STRIPE_SECRET_KEY
`,
    );
    const loaded = loadNinedeployManifest(workDir);

    const env: Record<string, string> = { DATABASE_URL: 'postgres://db' };
    const missing = findMissingRequiredEnv(loaded!.manifest, env);
    expect(missing).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('produces no nixpacks.toml when the manifest has no Nixpacks-relevant fields', () => {
    writeFileSync(
      path.join(workDir, '.ninedeploy'),
      `version: "1"
env:
  required:
    - DATABASE_URL
watch:
  paths:
    - apps/web/**
`,
    );
    const loaded = loadNinedeployManifest(workDir);
    expect(generateNixpacksToml(loaded!.manifest)).toBeNull();
  });
});
