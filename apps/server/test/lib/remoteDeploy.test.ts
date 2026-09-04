import { describe, expect, it } from 'vitest';
import {
  assertRemoteDeploySupported,
  remoteDeploySupported,
  remoteDeployUnsupportedReason,
} from '../../src/lib/remoteDeploy.js';

/**
 * r037. Remote deployments used to be refused for every service type, because
 * no builder read `server_id` and running anyway would have put the container
 * on the PANEL host while the panel reported the node. Docker services now
 * route through the node's agent; what remains is a narrower refusal for the
 * shapes the agent genuinely has no operation for.
 *
 * The reason strings are operator-facing — they are what someone reads in a
 * failed deployment — so they are asserted, not just the boolean.
 */
describe('remoteDeploySupported', () => {
  it('accepts docker and compose, and nothing else', () => {
    expect(remoteDeploySupported('docker')).toBe(true);
    // Most of the one-click template catalogue is compose-shaped, so without
    // this the whole template library was unavailable on a node.
    expect(remoteDeploySupported('compose')).toBe(true);
    expect(remoteDeploySupported('pm2')).toBe(false);
    expect(remoteDeploySupported('something-new')).toBe(false);
  });
});

describe('remoteDeployUnsupportedReason', () => {
  it('names the actual missing capability per type', () => {
    expect(remoteDeployUnsupportedReason('pm2')).toMatch(/host processes/);
    // An unrecognised type must still produce a sentence, not `undefined`.
    expect(remoteDeployUnsupportedReason('quantum')).toMatch(/"quantum" has no remote implementation/);
  });

  it('always tells the operator how to get unstuck', () => {
    for (const type of ['pm2', 'quantum']) {
      expect(remoteDeployUnsupportedReason(type)).toMatch(/Clear the target server/);
    }
  });
});

describe('assertRemoteDeploySupported', () => {
  it('passes a service that is not pinned to a node at all', () => {
    expect(() => assertRemoteDeploySupported({ serverId: null, type: 'pm2' })).not.toThrow();
    expect(() => assertRemoteDeploySupported({ type: 'pm2' })).not.toThrow();
  });

  it('passes a docker or compose service pinned to a node', () => {
    expect(() => assertRemoteDeploySupported({ serverId: 4, type: 'docker' })).not.toThrow();
    expect(() => assertRemoteDeploySupported({ serverId: 4, type: 'compose' })).not.toThrow();
  });

  it('defaults a missing type to docker rather than refusing', () => {
    expect(() => assertRemoteDeploySupported({ serverId: 4 })).not.toThrow();
    expect(() => assertRemoteDeploySupported({ serverId: 4, type: null })).not.toThrow();
  });

  it('throws a 400 with the machine-readable code the panel switches on', () => {
    try {
      assertRemoteDeploySupported({ serverId: 4, type: 'pm2' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      expect(e.statusCode).toBe(400);
      expect(e.code).toBe('remote_deploy_unsupported');
      expect(e.message).toMatch(/host processes/);
    }
  });
});
