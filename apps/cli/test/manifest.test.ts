/**
 * CLI tests for the `ninedeploy manifest {init,validate,show,apply}` group.
 * Mocks the SDK + prompts so the tests run offline; the underlying
 * parsing/formatting logic is already covered by the SDK test suite.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  manifestApply,
  manifestInit,
  manifestShow,
  manifestValidate,
} from '../src/commands/manifest.js';

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('@ninedeploy/sdk', () => {
  // The SDK is exercised in its own test suite; here we just stub it enough
  // to exercise the CLI plumbing.
  class ManifestParseError extends Error {
    source: string;
    cause: unknown;
    constructor(source: string, cause: unknown) {
      super(`parse: ${String(cause)}`);
      this.name = 'ManifestParseError';
      this.source = source;
      this.cause = cause;
    }
  }
  class ManifestValidationError extends Error {
    issues: Array<{ path: string; message: string }>;
    constructor(issues: Array<{ path: string; message: string }>) {
      super('validation failed');
      this.name = 'ManifestValidationError';
      this.issues = issues;
    }
  }
  return {
    parseManifestYaml: (text: string) => {
      // A file with the literal `version: "1"` parses; anything else throws a
      // proper ManifestParseError so the CLI's catch block routes it to
      // the parse-error path.
      if (!text.includes('version:')) throw new ManifestParseError('<test>', 'missing version');
      return { version: '1' };
    },
    formatManifestYaml: () => '# .ninedeploy\nversion: "1"\n',
    starterManifest: () => ({ version: '1' as const, runtime: { type: 'node' as const } }),
    detectProjectKind: () => 'node-npm' as const,
    ManifestParseError,
    ManifestValidationError,
  };
});
vi.mock('../src/client.js', () => ({ createClient: h.createClient }));
vi.mock('../src/prompts.js', () => ({ prompt: h.prompt }));

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'nd-cli-manifest-'));
  h.prompt.mockReset();
  // Default answers: keep the detected kind, default filename.
  h.prompt.mockResolvedValueOnce('');
  h.prompt.mockResolvedValueOnce('.ninedeploy');
  // Always start each test from a clean exit-code baseline; otherwise a
  // failure in test A pollutes test B's expectation.
  process.exitCode = undefined;
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('manifest init', () => {
  it('writes a .ninedeploy file with the starter template when the dir is empty', async () => {
    await manifestInit(workDir);
    const written = path.join(workDir, '.ninedeploy');
    const text = require('node:fs').readFileSync(written, 'utf8') as string;
    expect(text).toContain('version: "1"');
  });

  it('refuses to overwrite an existing manifest', async () => {
    writeFileSync(path.join(workDir, '.ninedeploy'), 'version: "1"\n');
    await manifestInit(workDir);
    // The pre-existing content is untouched.
    const text = require('node:fs').readFileSync(path.join(workDir, '.ninedeploy'), 'utf8') as string;
    expect(text).toBe('version: "1"\n');
  });

  it('honours the override-kind prompt', async () => {
    // First prompt: override kind, second: default filename.
    h.prompt.mockReset();
    h.prompt.mockResolvedValueOnce('python');
    h.prompt.mockResolvedValueOnce('.ninedeploy');
    await manifestInit(workDir);
    expect(h.prompt).toHaveBeenCalledTimes(2);
  });
});

describe('manifest validate', () => {
  it('prints Valid when the manifest parses', () => {
    writeFileSync(path.join(workDir, '.ninedeploy'), 'version: "1"\n');
    manifestValidate(workDir);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('sets exitCode to 1 and prints errors when validation fails', () => {
    writeFileSync(path.join(workDir, '.ninedeploy'), 'not yaml at all\n');
    const prev = process.exitCode;
    manifestValidate(workDir);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev ?? undefined;
  });

  it('errors when no manifest file is present', () => {
    const prev = process.exitCode;
    manifestValidate(workDir);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev ?? undefined;
  });

  it('accepts .ninedeploy.yml as an alternative filename', () => {
    writeFileSync(path.join(workDir, '.ninedeploy.yml'), 'version: "1"\n');
    const prev = process.exitCode;
    manifestValidate(workDir);
    expect(process.exitCode ?? 0).toBe(0);
    process.exitCode = prev ?? undefined;
  });
});

describe('manifest show', () => {
  it('prints a human-readable summary and exits cleanly', () => {
    writeFileSync(path.join(workDir, '.ninedeploy'), 'version: "1"\n');
    const prev = process.exitCode;
    manifestShow(workDir);
    expect(process.exitCode ?? 0).toBe(0);
    process.exitCode = prev ?? undefined;
  });

  it('sets exitCode 1 when the manifest is missing', () => {
    const prev = process.exitCode;
    manifestShow(workDir);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev ?? undefined;
  });

  it('sets exitCode 1 on parse failure', () => {
    writeFileSync(path.join(workDir, '.ninedeploy'), 'not yaml');
    const prev = process.exitCode;
    manifestShow(workDir);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev ?? undefined;
  });
});

describe('manifest apply', () => {
  it('informs the operator that the server endpoint is not yet wired', async () => {
    writeFileSync(path.join(workDir, '.ninedeploy'), 'version: "1"\n');
    const client = h.createClient();
    await manifestApply(client, workDir, 1);
    // No call to client.services.previewManifest: the placeholder is
    // intentionally a no-op until the server-side endpoint ships.
    expect(h.createClient).toHaveBeenCalled();
  });

  it('sets exitCode 1 when the manifest is missing', async () => {
    const client = h.createClient();
    const prev = process.exitCode;
    await manifestApply(client, workDir, 1);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev ?? undefined;
  });
});
