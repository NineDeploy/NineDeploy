import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  bootstrapServer,
  clearBootstrapLogs,
  getBootstrapLogs,
  runSshCommand,
  setBootstrapLogs,
  testSshConnection,
} from '../../src/engine/serverProvisioner.js';
import { createFakeDb } from '../helpers.js';

const execMocks = vi.hoisted(() => ({
  run: vi.fn(async (_cmd: string, _args: string[], _opts?: Record<string, unknown>, sink?: (l: string) => void) => {
    sink?.('PRETTY_NAME="Ubuntu 24.04 LTS"');
    sink?.('Docker version 27.1.1, build 6312585');
  }),
}));
vi.mock('../../src/lib/exec.js', () => execMocks);

const agentMocks = vi.hoisted(() => ({
  agentPing: vi.fn(async () => undefined),
  generateAgentToken: vi.fn(() => 'test-agent-token-1234567890123456'),
}));
vi.mock('../../src/lib/agentClient.js', () => agentMocks);

const cryptoMocks = vi.hoisted(() => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}));
vi.mock('../../src/lib/crypto.js', () => cryptoMocks);

describe('serverProvisioner engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBootstrapLogs(1);
    clearBootstrapLogs('test-key');
  });

  it('manages in-memory bootstrap logs store', () => {
    expect(getBootstrapLogs('unknown')).toEqual([]);
    setBootstrapLogs('test-key', ['log line 1', 'log line 2']);
    expect(getBootstrapLogs('test-key')).toEqual(['log line 1', 'log line 2']);
    clearBootstrapLogs('test-key');
    expect(getBootstrapLogs('test-key')).toEqual([]);
  });

  it('runs SSH command with key authentication and invokes line sink', async () => {
    const lines: string[] = [];
    const res = await runSshCommand(
      {
        host: '192.168.1.50',
        sshPort: 2222,
        sshUser: 'admin',
        authType: 'key',
        sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE\n-----END OPENSSH PRIVATE KEY-----',
      },
      'uptime',
      (l) => lines.push(l),
    );

    expect(res.exitCode).toBe(0);
    expect(execMocks.run).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining(['-p', '2222']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(lines.length).toBeGreaterThan(0);
  });

  it('tests SSH connection successfully with detected OS and Docker version', async () => {
    const res = await testSshConnection({
      host: '10.0.0.1',
      sshPort: 22,
      sshUser: 'root',
      authType: 'key',
    });

    expect(res.ok).toBe(true);
    expect(res.os).toBe('Ubuntu 24.04 LTS');
    expect(res.dockerInstalled).toBe(true);
    expect(res.dockerVersion).toBe('27.1.1');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('tests SSH connection with uname fallback when os-release is absent', async () => {
    execMocks.run.mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
      sink?.('Linux node-1 6.8.0-generic x86_64');
    });

    const res = await testSshConnection({
      host: '10.0.0.2',
      sshPort: 22,
      sshUser: 'root',
      authType: 'password',
    });

    expect(res.ok).toBe(true);
    expect(res.os).toContain('Linux node-1');
    expect(res.dockerInstalled).toBe(false);
  });

  it('tests SSH connection with generic Linux fallback when output is unrecognized', async () => {
    execMocks.run.mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
      sink?.('CustomOS 1.0');
    });

    const res = await testSshConnection({
      host: '10.0.0.25',
      sshPort: 22,
      sshUser: 'root',
      authType: 'key',
    });

    expect(res.ok).toBe(true);
    expect(res.os).toBe('Linux');
  });

  it('handles non-zero exit code during SSH test', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('SSH Connection failed (exit code 255)'));

    const res = await testSshConnection({
      host: '10.0.0.3',
      sshPort: 22,
      sshUser: 'root',
      authType: 'key',
    });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('SSH Connection failed (exit code 255)');
  });

  it('handles thrown error during SSH test', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('Connection timed out'));

    const res = await testSshConnection({
      host: '10.0.0.4',
      sshPort: 22,
      sshUser: 'root',
      authType: 'key',
    });

    expect(res.ok).toBe(false);
    expect(res.message).toBe('Connection timed out');
  });

  it('bootstraps server end-to-end when Docker is already installed', async () => {
    const steps: unknown[] = [];
    const logs: string[] = [];
    const db = createFakeDb({
      insert: {
        servers: [{ id: 1, name: 'Prod-Node-1', host: '192.168.1.100', port: 4600, status: 'online' }],
      },
    });

    const res = await bootstrapServer(
      db as never,
      {
        name: 'Prod-Node-1',
        host: '192.168.1.100',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
      (s) => steps.push(s),
      (l) => logs.push(l),
    );

    expect(res.ok).toBe(true);
    expect(res.serverId).toBe(1);
    expect(res.serverName).toBe('Prod-Node-1');
    expect(steps.length).toBeGreaterThan(3);
    expect(logs.length).toBeGreaterThan(0);
    expect(getBootstrapLogs(1).length).toBeGreaterThan(0);
  });

  it('installs Docker when missing and installDocker is true', async () => {
    // 1st run for connection test (no docker in stdout)
    execMocks.run.mockImplementationOnce(async (_cmd, opts) => {
      opts?.sink?.('PRETTY_NAME="Debian GNU/Linux 12"');
      return 0;
    });
    // 2nd run for docker install
    execMocks.run.mockResolvedValueOnce(0);
    // 3rd run for agent container start
    execMocks.run.mockResolvedValueOnce(0);

    const db = createFakeDb({
      insert: {
        servers: [{ id: 2, name: 'Debian-Node', host: '192.168.1.102', port: 4600, status: 'online' }],
      },
    });

    const res = await bootstrapServer(
      db as never,
      {
        name: 'Debian-Node',
        host: '192.168.1.102',
        sshPort: 22,
        sshUser: 'root',
        authType: 'password',
        sshPassword: 'password123',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(true);
    expect(res.serverId).toBe(2);
  });

  it('fails early if Docker is missing and installDocker is false', async () => {
    execMocks.run.mockImplementationOnce(async (_cmd, opts) => {
      opts?.sink?.('PRETTY_NAME="Alpine Linux"');
      return 0;
    });

    const db = createFakeDb({});
    const res = await bootstrapServer(
      db as never,
      {
        name: 'Alpine-Node',
        host: '192.168.1.103',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: false,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Docker is missing on remote host.');
  });

  it('fails when Docker automated installation script fails', async () => {
    execMocks.run.mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
      sink?.('PRETTY_NAME="Ubuntu 22.04"');
    });
    execMocks.run.mockRejectedValueOnce(new Error('Docker automated installation failed')); // docker install failure

    const db = createFakeDb({});
    const res = await bootstrapServer(
      db as never,
      {
        name: 'Fail-Docker-Node',
        host: '192.168.1.104',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Docker automated installation failed');
  });

  it('fails when agent container launch fails', async () => {
    execMocks.run.mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
      sink?.('PRETTY_NAME="Ubuntu 24.04"\nDocker version 27.0.0');
    });
    execMocks.run.mockRejectedValueOnce(new Error('Failed to launch agent container')); // agent launch failure

    const db = createFakeDb({});
    const res = await bootstrapServer(
      db as never,
      {
        name: 'Fail-Agent-Node',
        host: '192.168.1.105',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Failed to launch agent container');
  });

  it('retries agent ping on first timeout before succeeding', async () => {
    agentMocks.agentPing.mockRejectedValueOnce(new Error('Initial timeout'));
    agentMocks.agentPing.mockResolvedValueOnce(undefined);

    const db = createFakeDb({
      insert: {
        servers: [{ id: 5, name: 'Retry-Node', host: '192.168.1.106', port: 4600, status: 'online' }],
      },
    });

    const res = await bootstrapServer(
      db as never,
      {
        name: 'Retry-Node',
        host: '192.168.1.106',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(true);
    expect(agentMocks.agentPing).toHaveBeenCalledTimes(2);
  });

  it('fails when SSH connection probe fails at step 1', async () => {
    execMocks.run.mockRejectedValueOnce(new Error('SSH Connection failed'));

    const db = createFakeDb({});
    const res = await bootstrapServer(
      db as never,
      {
        name: 'Unreachable-Node',
        host: '192.168.1.199',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('SSH Connection failed');
  });

  it('handles database insert failure gracefully', async () => {
    const db = createFakeDb({
      insert: { servers: [] },
    });

    const res = await bootstrapServer(
      db as never,
      {
        name: 'DB-Fail-Node',
        host: '192.168.1.107',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Database save failed');
  });

  it('catches unexpected non-Error thrown errors during bootstrap', async () => {
    // 1st run for connection test (success)
    execMocks.run.mockImplementationOnce(async (_cmd, opts) => {
      opts?.sink?.('PRETTY_NAME="Ubuntu 24.04"\nDocker version 27.0.0');
      return 0;
    });
    // 2nd run throws non-Error during agent container launch
    execMocks.run.mockRejectedValueOnce('Raw fatal string');

    const db = createFakeDb({});
    const res = await bootstrapServer(
      db as never,
      {
        name: 'Fatal-String-Node',
        host: '192.168.1.109',
        sshPort: 0,
        sshUser: '',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Unexpected bootstrap error');
  });

  it('catches unexpected Error thrown errors during bootstrap steps', async () => {
    // 1st run for connection test (success)
    execMocks.run.mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
      sink?.('PRETTY_NAME="Ubuntu 24.04"\nDocker version 27.0.0');
    });
    // 2nd run throws Error during agent container launch
    execMocks.run.mockRejectedValueOnce(new Error('Agent deploy failure'));

    const db = createFakeDb({});
    const res = await bootstrapServer(
      db as never,
      {
        name: 'Fatal-Error-Node',
        host: '192.168.1.110',
        sshPort: 22,
        sshUser: 'root',
        authType: 'key',
        installDocker: true,
        agentPort: 4600,
      },
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Agent deploy failure');
  });

  it('handles non-Error thrown during SSH connection test', async () => {
    execMocks.run.mockRejectedValueOnce('raw probe rejection');

    const res = await testSshConnection({
      host: '10.0.0.99',
      sshPort: 0,
      sshUser: '',
      authType: 'key',
    });

    expect(res.ok).toBe(false);
    expect(res.message).toBe('SSH Connection probe failed');
  });
});
