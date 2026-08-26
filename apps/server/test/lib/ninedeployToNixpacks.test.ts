import { describe, expect, it } from 'vitest';
import type { NinedeployManifest } from '@ninedeploy/schemas';
import { generateNixpacksToml } from '../../src/lib/ninedeployToNixpacks.js';

const manifest = (overrides: Partial<NinedeployManifest>): NinedeployManifest => ({
  version: '1',
  ...overrides,
});

describe('generateNixpacksToml', () => {
  it('returns null when the manifest has no Nixpacks-relevant fields', () => {
    expect(generateNixpacksToml(manifest({}))).toBeNull();
    expect(generateNixpacksToml(manifest({ env: { required: ['X'] } }))).toBeNull();
    expect(
      generateNixpacksToml(manifest({ watch: { paths: ['apps/**'] } })),
    ).toBeNull();
  });

  it('emits [phases.setup] nixPkgs from a runtime version pin', () => {
    const toml = generateNixpacksToml(
      manifest({ runtime: { type: 'node', version: '20' } }),
    );
    expect(toml).toContain('[phases.setup]');
    expect(toml).toContain('nixPkgs = [');
    expect(toml).toContain('"nodejs_20"');
  });

  it('emits a Python package pin for python runtimes', () => {
    const toml = generateNixpacksToml(
      manifest({ runtime: { type: 'python', version: '3.12' } }),
    );
    expect(toml).toContain('"python312"');
  });

  it('emits a Go package pin for go runtimes', () => {
    const toml = generateNixpacksToml(
      manifest({ runtime: { type: 'go', version: '1.22' } }),
    );
    expect(toml).toContain('"go_122"');
  });

  it('emits NIXPACKS_NODE_VERSION in [variables] when node version is pinned', () => {
    const toml = generateNixpacksToml(
      manifest({ runtime: { type: 'node', version: '20' } }),
    );
    expect(toml).toContain('[variables]');
    expect(toml).toContain('NIXPACKS_NODE_VERSION = "20"');
  });

  it('does NOT pin a package for type=auto', () => {
    const toml = generateNixpacksToml(manifest({ runtime: { type: 'auto' } }));
    expect(toml).toBeNull();
  });

  it('does NOT pin a package when version is missing', () => {
    const toml = generateNixpacksToml(manifest({ runtime: { type: 'node' } }));
    expect(toml).toBeNull();
  });

  it('appends manifest phases.setup.pkgs alongside the runtime pin', () => {
    const toml = generateNixpacksToml(
      manifest({
        runtime: { type: 'node', version: '20' },
        phases: { setup: { pkgs: ['python310', 'imagemagick'] } },
      }),
    );
    expect(toml).toContain('"nodejs_20"');
    expect(toml).toContain('"python310"');
    expect(toml).toContain('"imagemagick"');
  });

  it('emits [phases.setup] from phases.setup.pkgs alone when runtime is auto', () => {
    const toml = generateNixpacksToml(
      manifest({ phases: { setup: { pkgs: ['imagemagick'] } } }),
    );
    expect(toml).toContain('[phases.setup]');
    expect(toml).toContain('"imagemagick"');
  });

  it('emits [phases.install] from build.install', () => {
    const toml = generateNixpacksToml(manifest({ build: { install: 'npm ci' } }));
    expect(toml).toContain('[phases.install]');
    expect(toml).toContain('cmds = [');
    expect(toml).toContain('"npm ci"');
  });

  it('emits [phases.build] from build.build', () => {
    const toml = generateNixpacksToml(manifest({ build: { build: 'npm run build' } }));
    expect(toml).toContain('[phases.build]');
    expect(toml).toContain('"npm run build"');
  });

  it('concatenates build.build with phases.build.cmds in [phases.build]', () => {
    const toml = generateNixpacksToml(
      manifest({
        build: { build: 'npm run build' },
        phases: { build: { cmds: ['npm run build:assets', 'npm run build:server'] } },
      }),
    );
    expect(toml).toContain('"npm run build"');
    expect(toml).toContain('"npm run build:assets"');
    expect(toml).toContain('"npm run build:server"');
  });

  it('emits [phases.start] with the start command', () => {
    const toml = generateNixpacksToml(manifest({ build: { start: 'node server.js' } }));
    expect(toml).toContain('[phases.start]');
    expect(toml).toContain('cmd = "node server.js"');
  });

  it('emits a complete nixpacks.toml for a full Node manifest', () => {
    const toml = generateNixpacksToml(
      manifest({
        runtime: { type: 'node', version: '20' },
        build: { install: 'npm ci', build: 'npm run build', start: 'node server.js' },
        phases: {
          setup: { pkgs: ['python310'] },
          build: { cmds: ['npm run build:assets'] },
        },
      }),
    );
    expect(toml).toContain('[phases.setup]');
    expect(toml).toContain('"nodejs_20"');
    expect(toml).toContain('"python310"');
    expect(toml).toContain('[phases.install]');
    expect(toml).toContain('"npm ci"');
    expect(toml).toContain('[phases.build]');
    expect(toml).toContain('"npm run build"');
    expect(toml).toContain('"npm run build:assets"');
    expect(toml).toContain('[phases.start]');
    expect(toml).toContain('"node server.js"');
    expect(toml).toContain('[variables]');
    expect(toml).toContain('NIXPACKS_NODE_VERSION = "20"');
  });

  it('escapes embedded double quotes and backslashes in command values', () => {
    const toml = generateNixpacksToml(
      manifest({ build: { build: 'echo "hi" \\path' } }),
    );
    expect(toml).toContain('"echo \\"hi\\" \\\\path"');
  });
});
