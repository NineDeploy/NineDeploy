import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runOp } from '../src/agent.js';

const spawnMock = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('../src/lib/spawnValidated.js', () => ({ spawnValidated: spawnMock }));
const dockerPullMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/lib/dockerPull.js', () => ({ pullDockerImage: dockerPullMock }));

/** Capture the argv a runOp call spawned with. */
async function argvOf(op: string, params: Record<string, unknown>): Promise<string[]> {
  const code = await runOp(op, params, () => {});
  expect(code).toBe(0);
  return (spawnMock.mock.calls.at(-1) as unknown[])[1] as string[];
}

describe('agent typed-op argv templates', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockResolvedValue(0);
  });

  it('docker.pull', async () => {
    const log = vi.fn();
    await expect(runOp('docker.pull', { image: 'nginx:1' }, log)).resolves.toBe(0);
    expect(dockerPullMock).toHaveBeenCalledWith('nginx:1', log);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('docker.networkCreate builds a validated argv', async () => {
    expect(await argvOf('docker.networkCreate', { name: 'net-a', driver: 'overlay' })).toEqual([
      'network', 'create', '--driver', 'overlay', 'net-a',
    ]);
    // Unknown drivers fall back to bridge; omitted driver adds no flag.
    expect(await argvOf('docker.networkCreate', { name: 'net-b', driver: 'weird' })).toEqual([
      'network', 'create', '--driver', 'bridge', 'net-b',
    ]);
    expect(await argvOf('docker.networkCreate', { name: 'net-c' })).toEqual(['network', 'create', 'net-c']);
  });

  it('docker.networkCreate rejects hostile names', async () => {
    await expect(argvOf('docker.networkCreate', { name: 'a;rm' })).rejects.toThrow('Invalid network name');
  });

  it('docker.networkRm / connect / disconnect', async () => {
    expect(await argvOf('docker.networkRm', { name: 'net-a' })).toEqual(['network', 'rm', 'net-a']);
    expect(await argvOf('docker.networkConnect', { network: 'net-a', container: 'web-1' })).toEqual([
      'network', 'connect', 'net-a', 'web-1',
    ]);
    expect(await argvOf('docker.networkDisconnect', { network: 'net-a', container: 'web-1' })).toEqual([
      'network', 'disconnect', 'net-a', 'web-1',
    ]);
    await expect(argvOf('docker.networkConnect', { network: 'net-a', container: 'x;y' })).rejects.toThrow(
      'Invalid container name',
    );
  });

  it('docker.build', async () => {
    expect(await argvOf('docker.build', { tag: 'app:1', dockerfile: 'Dockerfile', context: '.' })).toEqual(
      ['build', '-t', 'app:1', '-f', 'Dockerfile', '.'],
    );
    await expect(argvOf('docker.build', { tag: 'app:1', dockerfile: '../Dockerfile', context: '.' })).rejects.toThrow(
      'Invalid dockerfile',
    );
    await expect(argvOf('docker.build', { tag: 'app:1', dockerfile: 'Dockerfile', context: 'foo/../../bar' })).rejects.toThrow(
      'Invalid context',
    );
  });

  it('docker.run builds the fixed flag block', async () => {
    const argv = await argvOf('docker.run', { name: 'web-3', image: 'nginx' });
    expect(argv.slice(0, 8)).toEqual(['run', '-d', '--name', 'web-3', '--restart', 'unless-stopped', '--network', 'ninedeploy']);
    expect(argv[argv.length - 1]).toBe('nginx');
  });

  it('docker.run appends resource limits and volume when given', async () => {
    const argv = await argvOf('docker.run', {
      name: 'w', image: 'i', cpuShares: '512', memLimitMb: '256', volume: 'nd-svc-w-data', mount: '/data',
    });
    expect(argv).toContain('--cpu-shares');
    expect(argv).toContain('512');
    expect(argv).toContain('--memory');
    expect(argv).toContain('256m');
    expect(argv).toContain('nd-svc-w-data:/data');
  });

  it('docker.run clamps non-numeric limits', async () => {
    const argv = await argvOf('docker.run', { name: 'w', image: 'i', cpuShares: 'abc', memLimitMb: 'xyz' });
    expect(argv).toContain('0');
    expect(argv).toContain('0m');
  });

  it('docker.runEnv appends the env-file flag', async () => {
    const argv = await argvOf('docker.runEnv', { name: 'w', image: 'i', envFile: '.agent-env/w.env' });
    expect(argv).toContain('--env-file');
    expect(argv).toContain('.agent-env/w.env');
  });

  it('docker.stop / rm / logs / inspect', async () => {
    expect(await argvOf('docker.stop', { name: 'c1' })).toEqual(['stop', '-t', '5', 'c1']);
    expect(await argvOf('docker.rm', { name: 'c1' })).toEqual(['rm', '-f', 'c1']);
    expect(await argvOf('docker.logs', { name: 'c1' })).toEqual(['logs', '--tail', '300', '--timestamps', 'c1']);
    expect((await argvOf('docker.inspect', { name: 'c1', format: 'state' }))[3]).toContain('{{.State.Status}}');
    expect((await argvOf('docker.inspect', { name: 'c1' }))[3]).toBe('{{.Image}}');
  });

  it('docker.login/logout with and without a registry server', async () => {
    expect(await argvOf('docker.login', { username: 'u' })).toEqual(['login', '--username', 'u', '--password-stdin']);
    expect(await argvOf('docker.login', { username: 'u', server: 'ghcr.io' })).toEqual(
      ['login', '--username', 'u', '--password-stdin', 'ghcr.io'],
    );
    expect(await argvOf('docker.logout', {})).toEqual(['logout']);
    expect(await argvOf('docker.logout', { server: 'ghcr.io' })).toEqual(['logout', 'ghcr.io']);
  });

  it('docker compose up/down', async () => {
    expect(await argvOf('docker.composeUp', { project: 'p', file: 'docker-compose.yml' })).toEqual(
      ['compose', '-p', 'p', '-f', 'docker-compose.yml', 'up', '-d', '--build', '--remove-orphans'],
    );
    expect(await argvOf('docker.composeDown', { project: 'p' })).toEqual(['compose', '-p', 'p', 'down', '--remove-orphans']);
  });

  it('git ops', async () => {
    expect(await argvOf('git.clone', { url: 'https://x/y.git', dir: 'repo' })).toEqual(
      ['clone', 'https://x/y.git', 'repo'],
    );
    expect(await argvOf('git.clone', { url: 'https://x/y.git', depth: '50' })).toEqual(
      ['clone', '--depth', '50', 'https://x/y.git', '.'],
    );
    expect(await argvOf('git.fetch', {})).toEqual(['fetch', '--all']);
    expect(await argvOf('git.checkout', { ref: 'main' })).toEqual(['checkout', 'main']);
    expect(await argvOf('git.checkout', {})).toEqual(['checkout', 'HEAD']);
    expect(await argvOf('git.rev-parse', {})).toEqual(['rev-parse', 'HEAD']);
    expect(await argvOf('git.reset', { sha: 'abcdef1234' })).toEqual(['reset', '--hard', 'abcdef1234']);
    expect(await argvOf('git.reset', {})).toEqual(['reset', '--hard', 'HEAD']);
  });

  it('rejects dash-leading git operands as options, not refs (r011)', async () => {
    // Both of these passed RE_REF before the position-0 anchor was added:
    // git would read them as options (`checkout -b`, and `clone --upload-pack`
    // consuming the target dir as its value), not as the intended operands.
    await expect(argvOf('git.checkout', { ref: '-b' })).rejects.toThrow('Invalid ref');
    await expect(argvOf('git.clone', { url: '--upload-pack', dir: 'repo' })).rejects.toThrow('Invalid repo url');
    // Belt and braces: `=` was never in the charset, but it must stay rejected.
    await expect(argvOf('git.clone', { url: '--config=core.sshCommand=/bin/true', dir: 'r' })).rejects.toThrow(
      'Invalid repo url',
    );
  });

  it('docker.runEnv without limits or volume', async () => {
    const argv = await argvOf('docker.runEnv', { name: 'w', image: 'i', envFile: 'e.env' });
    expect(argv).not.toContain('--cpu-shares');
    expect(argv).not.toContain('--memory');
    expect(argv).not.toContain('-v');
  });

  it('docker.runEnv with limits, volume and mount default', async () => {
    const argv = await argvOf('docker.runEnv', {
      name: 'w', image: 'i', envFile: 'e.env', cpuShares: '128', memLimitMb: '64',
      volume: 'nd-svc-w-data',
    });
    expect(argv).toContain('128');
    expect(argv).toContain('64m');
    expect(argv).toContain('nd-svc-w-data:/');
  });

  it('docker.runEnv clamps non-numeric limits', async () => {
    const argv = await argvOf('docker.runEnv', { name: 'w', image: 'i', envFile: 'e.env', cpuShares: 'oops', memLimitMb: 'nah' });
    expect(argv).toContain('0');
    expect(argv).toContain('0m');
  });

  it('docker.run volume without an explicit mount defaults to /', async () => {
    const argv = await argvOf('docker.run', { name: 'w', image: 'i', volume: 'nd-svc-w-data' });
    expect(argv).toContain('nd-svc-w-data:/');
  });

  it('clamps an invalid clone depth to 1', async () => {
    expect(await argvOf('git.clone', { url: 'https://x/y.git', depth: '9999' })).toEqual(
      ['clone', '--depth', '1', 'https://x/y.git', '.'],
    );
  });
});
