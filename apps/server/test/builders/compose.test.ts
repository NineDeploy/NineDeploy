import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeBuilder } from '../../src/engine/builders/compose.js';
import { NOW } from '../helpers.js';

const h = vi.hoisted(() => {
  const run = vi.fn(async (_cmd: string, _args: unknown[], _opts: unknown, sink?: (line: string) => void) => {
    sink?.('');
  });
  const capture = vi.fn(async () => 'running');
  return { run, capture };
});
vi.mock('../../src/lib/exec.js', () => ({ run: h.run, sleep: vi.fn(async () => undefined), capture: h.capture }));

const tmp = mkdtempSync(path.join(os.tmpdir(), 'nd-compose-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const makeCtx = (over: Record<string, unknown> = {}) => ({
  deploymentId: 3,
  service: { slug: 'stack', composeService: 'api', port: 3000, healthPath: '/' },
  buildConfig: { dockerfilePath: 'compose.yaml' },
  workDir: tmp,
  commitSha: 'abcdef1',
  env: { TOKEN: 'secret-value' },
  log: vi.fn(),
  ...over,
});

describe('composeBuilder.buildAndRun', () => {
  beforeEach(() => {
    h.run.mockReset();
    h.run.mockImplementation(async (_cmd: string, _args: unknown[], _opts: unknown, sink?: (line: string) => void) => {
      sink?.('');
    });
    h.capture.mockClear();
    h.capture.mockResolvedValue('running');
  });

  it('brings the project up with env vars in a temporary .env', async () => {
    const runtime = await composeBuilder.buildAndRun(makeCtx() as never);

    // Previous revision torn down first â€” with -f so a non-default compose
    // file is honored â€” then up --build.
    const downCall = h.run.mock.calls.find((c) => (c[1] as string[])[5] === 'down');
    expect(downCall).toBeTruthy();
    expect((downCall![1] as string[])).toEqual(['compose', '-p', 'ndcmp-stack', '-f', 'compose.yaml', 'down', '--remove-orphans']);
    const upCall = h.run.mock.calls.find((c) => (c[1] as string[])[5] === 'up');
    expect((upCall![1] as string[])).toEqual(['compose', '-p', 'ndcmp-stack', '-f', 'compose.yaml', 'up', '-d', '--build', '--remove-orphans']);
    expect(upCall![2]).toMatchObject({ cwd: tmp });

    // The .env was written and cleaned up afterwards.
    expect(existsSync(path.join(tmp, '.env'))).toBe(false);

    // The main container follows docker compose's naming convention.
    expect(runtime.runtimeId).toBe('ndcmp-stack-api-1');
    expect(runtime.port).toBe(3000);
    expect(runtime.healthPath).toBe('/');
    expect(runtime.imageDigest).toBeUndefined();
  });

  it('writes secrets into the temporary .env and removes it even on failure', async () => {
    const dotEnvPath = path.join(tmp, '.env');
    // Capture content mid-flight: inspect after the up call starts.
    let seen: string | null = null;
    h.run.mockImplementation(async (_c, a, _o, sink) => {
      sink?.('');
      if ((a as string[])[5] === 'up') {
        seen = readFileSync(dotEnvPath, 'utf8');
        throw new Error('build failed');
      }
    });
    await expect(composeBuilder.buildAndRun(makeCtx() as never)).rejects.toThrow('build failed');
    expect(seen).toContain('TOKEN=secret-value');
    expect(existsSync(dotEnvPath)).toBe(false);
  });

  it('defaults the compose file and main service from the slug', async () => {
    const runtime = await composeBuilder.buildAndRun(
      makeCtx({ service: { slug: 'solo', port: null, healthPath: '' }, buildConfig: undefined }) as never,
    );
    const upCall = h.run.mock.calls.find((c) => (c[1] as string[])[5] === 'up');
    expect((upCall![1] as string[])).toContain('docker-compose.yml');
    expect(runtime.runtimeId).toBe('ndcmp-solo-solo-1');
  });

  it('skips the .env when there are no env vars', async () => {
    const dotEnvPath = path.join(tmp, '.env');
    await composeBuilder.buildAndRun(makeCtx({ env: {} }) as never);
    expect(existsSync(dotEnvPath)).toBe(false);
  });

  it('tolerates a failing previous-revision teardown', async () => {
    h.run.mockImplementation(async (_c, a, _o, sink) => {
      sink?.('');
      if ((a as string[])[5] === 'down') throw new Error('no such project');
    });
    const runtime = await composeBuilder.buildAndRun(makeCtx() as never);
    expect(runtime.runtimeId).toBe('ndcmp-stack-api-1');
  });

  it('writes an override compose file with -v mounts when attachments are present, and removes it afterwards', async () => {
    const overridePath = path.join(tmp, '.ninedeploy.compose.override.yml');
    const ctx = makeCtx({
      service: { slug: 'stack', composeService: 'api', port: 3000, healthPath: '/' },
      volumeAttachments: [
        { id: 1, serviceId: 1, volumeName: 'nd-svc-stack-uploads', containerPath: '/uploads', readOnly: false, createdAt: NOW, updatedAt: NOW },
        { id: 2, serviceId: 1, volumeName: 'nd-svc-stack-config', containerPath: '/etc/app', readOnly: true, createdAt: NOW, updatedAt: NOW },
      ],
    });

    let seenOverride: string | null = null;
    h.run.mockImplementation(async (_c, a, _o, sink) => {
      sink?.('');
      const args = a as string[];
      if (args.includes('up')) {
        seenOverride = readFileSync(overridePath, 'utf8');
      }
    });

    await composeBuilder.buildAndRun(ctx as never);

    // The override file was written and then cleaned up.
    expect(seenOverride).not.toBeNull();
    expect(seenOverride).toContain('services:');
    expect(seenOverride).toContain('  api:');
    expect(seenOverride).toContain('      - "nd-svc-stack-uploads:/uploads"');
    expect(seenOverride).toContain('      - "nd-svc-stack-config:/etc/app:ro"');
    expect(seenOverride).toContain('volumes:');
    expect(seenOverride).toContain('  nd-svc-stack-uploads:');
    expect(seenOverride).toContain('  nd-svc-stack-config:');
    // Each top-level volume is external (the user owns the named volume).
    expect(seenOverride).toContain('    external: true');
    expect(existsSync(overridePath)).toBe(false);

    // Both `down` and `up` invocations pass the override via -f.
    const downCall = h.run.mock.calls.find((c) => (c[1] as string[]).includes('down'));
    const upCall = h.run.mock.calls.find((c) => (c[1] as string[]).includes('up'));
    const downArgs = downCall![1] as string[];
    const upArgs = upCall![1] as string[];
    // Compose builder uses the absolute path of the override file in the
    // -f flag (it's written into the workdir).
    expect(downArgs).toEqual(expect.arrayContaining([overridePath]));
    expect(upArgs).toEqual(expect.arrayContaining([overridePath]));
  });

  it('omits the override file entirely when there are no attachments', async () => {
    const overridePath = path.join(tmp, '.ninedeploy.compose.override.yml');
    const ctx = makeCtx({ volumeAttachments: [] });
    await composeBuilder.buildAndRun(ctx as never);
    expect(existsSync(overridePath)).toBe(false);
    const upCall = h.run.mock.calls.find((c) => (c[1] as string[]).includes('up'));
    expect((upCall![1] as string[])).not.toContain(overridePath);
  });
});

describe('composeBuilder.isHealthy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.capture.mockResolvedValue('running');
  });

  it('returns true when the main container is running', async () => {
    const ok = await composeBuilder.isHealthy({ runtimeId: 'ndcmp-stack-api-1', port: 3000, healthPath: '/' }, 5000);
    expect(ok).toBe(true);
    expect(h.capture).toHaveBeenCalledWith('docker', ['inspect', 'ndcmp-stack-api-1', '--format', '{{.State.Status}}']);
  });

  it('returns false when the container never comes up', async () => {
    h.capture.mockRejectedValue(new Error('no such container'));
    const ok = await composeBuilder.isHealthy({ runtimeId: 'x', port: null, healthPath: '/' }, 10, 0);
    expect(ok).toBe(false);
  });

  it('retries until a non-running status becomes running', async () => {
    h.capture
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('running');
    const ok = await composeBuilder.isHealthy({ runtimeId: 'x', port: null, healthPath: '/' }, 5000);
    expect(ok).toBe(true);
    expect(h.capture.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('composeBuilder.stop', () => {
  it('tears the project down using the container\'s own compose labels', async () => {
    h.run.mockClear();
    // The label inspect yields project + config file(s), tab-separated.
    h.capture.mockResolvedValueOnce('ndcmp-stack\t/opt/app/compose.yaml');
    await composeBuilder.stop('ndcmp-stack-api-1');
    const downCall = h.run.mock.calls[0];
    expect(h.capture).toHaveBeenCalledWith(
      'docker',
      ['inspect', 'ndcmp-stack-api-1', '--format', expect.stringContaining('com.docker.compose.project')],
    );
    expect((downCall![1] as string[])).toEqual(['compose', '-p', 'ndcmp-stack', '-f', '/opt/app/compose.yaml', 'down', '--remove-orphans']);
  });

  it('works for hyphenated project/service names (no string surgery)', async () => {
    h.run.mockClear();
    h.capture.mockResolvedValueOnce('ndcmp-my-app\t/app/docker-compose.yml');
    await composeBuilder.stop('ndcmp-my-app-web-api-1');
    expect((h.run.mock.calls[0]![1] as string[])).toEqual(['compose', '-p', 'ndcmp-my-app', '-f', '/app/docker-compose.yml', 'down', '--remove-orphans']);
  });

  it('does nothing when the container (and its labels) are already gone', async () => {
    h.run.mockClear();
    h.capture.mockRejectedValueOnce(new Error('No such object'));
    await expect(composeBuilder.stop('gone-1')).resolves.toBeUndefined();
    expect(h.run).not.toHaveBeenCalled();
  });

  it('does nothing when the container has no compose project label', async () => {
    h.run.mockClear();
    h.capture.mockResolvedValueOnce('\t');
    await expect(composeBuilder.stop('some-container-1')).resolves.toBeUndefined();
    expect(h.run).not.toHaveBeenCalled();
  });

  it('stops without -f when the container reports no config files', async () => {
    h.run.mockClear();
    h.capture.mockResolvedValueOnce('ndcmp-stack');
    await composeBuilder.stop('ndcmp-stack-api-1');
    expect((h.run.mock.calls[0]![1] as string[])).toEqual(['compose', '-p', 'ndcmp-stack', 'down', '--remove-orphans']);
  });

  it('passes every comma-separated config file', async () => {
    h.run.mockClear();
    h.capture.mockResolvedValueOnce('p\t/base.yml, /override.yml');
    await composeBuilder.stop('p-api-1');
    expect((h.run.mock.calls[0]![1] as string[])).toEqual([
      'compose', '-p', 'p', '-f', '/base.yml', '-f', '/override.yml', 'down', '--remove-orphans',
    ]);
  });

  it('swallows failures', async () => {
    h.run.mockClear();
    h.capture.mockResolvedValueOnce('p\t/c.yml');
    h.run.mockRejectedValueOnce(new Error('compose not installed'));
    await expect(composeBuilder.stop('ndcmp-stack-api-1')).resolves.toBeUndefined();
  });
});
