import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTransientSnapshotFailure, pullDockerImage } from '../../src/lib/dockerPull.js';

const h = vi.hoisted(() => ({
  run: vi.fn(),
  sleep: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/exec.js', () => ({ run: h.run, sleep: h.sleep }));

describe('pullDockerImage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recognizes containerd snapshot extraction races', () => {
    expect(isTransientSnapshotFailure(['target snapshot "sha256:abc" already exists'])).toBe(true);
    expect(isTransientSnapshotFailure(['parent snapshot sha256:abc does not exist'])).toBe(true);
    expect(isTransientSnapshotFailure(['unauthorized: authentication required'])).toBe(false);
  });

  it('retries a transient snapshot failure and preserves streamed logs', async () => {
    h.run
      .mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
        sink('unable to prepare extraction snapshot: target snapshot already exists');
        throw new Error('docker pull exited 1');
      })
      .mockResolvedValueOnce(undefined);
    const log = vi.fn();

    await pullDockerImage('traefik:3', log);

    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.sleep).toHaveBeenCalledWith(2000);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('retrying (2/3)'));
  });

  it('does not retry unrelated pull failures', async () => {
    h.run.mockImplementationOnce(async (_cmd, _args, _opts, sink) => {
      sink('unauthorized: authentication required');
      throw new Error('docker pull exited 1');
    });

    await expect(pullDockerImage('private/image', vi.fn())).rejects.toThrow('docker pull exited 1');
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });

  it('stops after the bounded attempt count', async () => {
    h.run.mockImplementation(async (_cmd, _args, _opts, sink) => {
      sink('failed to prepare extraction snapshot: parent snapshot sha256:x does not exist');
      throw new Error('still broken');
    });

    await expect(pullDockerImage('n8nio/n8n', vi.fn())).rejects.toThrow('still broken');
    expect(h.run).toHaveBeenCalledTimes(3);
    expect(h.sleep).toHaveBeenCalledTimes(2);
  });
});
