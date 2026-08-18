import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NineDeployClient } from '@ninedeploy/sdk';
import { housekeepingPrune } from '../src/commands/housekeeping.js';

describe('CLI housekeeping command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const fakeClient = {
    housekeeping: {
      runPrune: vi.fn(),
    },
  } as unknown as NineDeployClient;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('runs housekeeping prune successfully and prints reclaimed space and details', async () => {
    vi.mocked(fakeClient.housekeeping.runPrune).mockResolvedValueOnce({
      ok: true,
      freedBytes: 104857600,
      diskUsedPercentAfter: 42,
      details: {
        imagesFreed: '2.5 GB',
      },
    });

    await housekeepingPrune(fakeClient);

    expect(logSpy).toHaveBeenCalledWith('  ✓ System housekeeping prune completed.');
    expect(logSpy).toHaveBeenCalledWith('    Space reclaimed: 100.0 MB');
    expect(logSpy).toHaveBeenCalledWith('    Disk used after: 42%');
    expect(logSpy).toHaveBeenCalledWith('    Images freed:    2.5 GB');
  });

  it('runs housekeeping prune with defaults when details are omitted', async () => {
    vi.mocked(fakeClient.housekeeping.runPrune).mockResolvedValueOnce({
      ok: true,
      freedBytes: 0,
      diskUsedPercentAfter: 20,
      details: {},
    });

    await housekeepingPrune(fakeClient);

    expect(logSpy).toHaveBeenCalledWith('  ✓ System housekeeping prune completed.');
    expect(logSpy).toHaveBeenCalledWith('    Space reclaimed: 0 B');
    expect(logSpy).toHaveBeenCalledWith('    Disk used after: 20%');
  });

  it('handles housekeeping error', async () => {
    vi.mocked(fakeClient.housekeeping.runPrune).mockRejectedValueOnce(new Error('Prune failed'));
    await expect(housekeepingPrune(fakeClient)).rejects.toThrow('Prune failed');
  });
});
