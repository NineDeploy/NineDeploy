import { describe, expect, it, vi } from 'vitest';

const execMocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../../src/lib/exec.js', () => execMocks);

import { listManagedVolumeNames, listUserNetworks, networkMembers, containerRunning, resolveVolumeOwner } from '../../src/lib/inventory.js';
import { dbRow, svcRow } from '../helpers.js';

describe('lib/inventory', () => {
  it('resolveVolumeOwner maps service, database and non-managed names', () => {
    const svcs = [svcRow({ id: 2, slug: 'web', name: 'web', runtimeId: 'web-2' })];
    const dbs = [dbRow({ id: 3, slug: 'pg', name: 'pg', engine: 'postgres', containerName: 'nd-db-pg' })];
    expect(resolveVolumeOwner(svcs, dbs, 'nd-svc-web-data')).toEqual({ kind: 'service', refId: 2, name: 'web', containerName: 'web-2' });
    expect(resolveVolumeOwner(svcs, dbs, 'nd-db-pg-data')).toEqual({ kind: 'database', refId: 3, name: 'pg', engine: 'postgres', containerName: 'nd-db-pg' });
    expect(resolveVolumeOwner(svcs, dbs, 'nd-svc-ghost-data')).toBeNull();
    expect(resolveVolumeOwner(svcs, dbs, 'some-other-volume')).toBeNull(); // non-managed prefix
  });

  it('listManagedVolumeNames filters to nd- prefixed volumes', async () => {
    execMocks.capture.mockResolvedValue('nd-svc-web-data\nrandom-vol\nnd-db-pg-data\n');
    await expect(listManagedVolumeNames()).resolves.toEqual(['nd-svc-web-data', 'nd-db-pg-data']);
  });

  it('listUserNetworks drops builtin networks', async () => {
    execMocks.capture.mockResolvedValue('bridge\tbridge\nhost\thost\nnone\tbridge\nninedeploy\tbridge\n');
    await expect(listUserNetworks()).resolves.toEqual([{ name: 'ninedeploy', driver: 'bridge' }]);
  });

  it('networkMembers parses the inspect output', async () => {
    execMocks.capture.mockResolvedValue('web-2 ninedeploy-traefik ');
    await expect(networkMembers('ninedeploy')).resolves.toEqual(['web-2', 'ninedeploy-traefik']);
  });

  it('containerRunning treats docker failures as not-running', async () => {
    execMocks.capture.mockRejectedValue(new Error('daemon down'));
    await expect(containerRunning('web-2')).resolves.toBe(false);
    await expect(containerRunning(null)).resolves.toBe(false);
    execMocks.capture.mockResolvedValue('  ');
    await expect(containerRunning('web-2')).resolves.toBe(false);
  });
});
