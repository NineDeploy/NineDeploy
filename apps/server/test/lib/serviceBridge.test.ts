/**
 * G-20 per-service Docker bridge — lib coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execState = vi.hoisted(() => ({
  byArgs: new Map<string, { stdout?: string; throw?: Error }>(),
  runCalls: [] as Array<{ tool: string; args: string[] }>,
}));

vi.mock('../../src/lib/exec.js', () => ({
  capture: vi.fn(async (tool: string, args: string[] = []) => {
    const key = `${tool} ${args.join(' ')}`;
    const r = execState.byArgs.get(key);
    if (r?.throw) throw r.throw;
    return r?.stdout ?? '';
  }),
  run: vi.fn(async (tool: string, args: string[] = []) => {
    execState.runCalls.push({ tool, args });
    const key = `${tool} ${args.join(' ')}`;
    const r = execState.byArgs.get(key);
    if (r?.throw) throw r.throw;
  }),
}));

vi.mock('../../src/engine/dockerNames.js', () => ({
  NETWORK: 'ninedeploy',
  TRAEFIK_CONTAINER: 'nd-traefik',
}));

import {
  connectContainerToServiceBridge,
  connectTraefikToComposeNetwork,
  ensureServiceBridge,
  reapTraefikNetworks,
  removeServiceBridgeIfEmpty,
  serviceBridgeName,
} from '../../src/lib/serviceBridge.js';

beforeEach(() => {
  execState.byArgs.clear();
  execState.runCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HAS_ND_SVC = 'nd-svc-foo\n';
// `docker network create nd-svc-foo` preserves the hyphenated name in
// `inspect` output (`{"nd-svc-foo": ...}`), so the lib's literal-string
// search matches correctly and the operation is idempotent.
const TRAEFIK_WITH_ND_SVC_FOO = JSON.stringify({ 'nd-svc-foo': {} });
const TRAEFIK_NO_BRIDGE = JSON.stringify({});

describe('serviceBridgeName', () => {
  it('returns the canonical per-slug bridge name', () => {
    expect(serviceBridgeName('foo')).toBe('nd-svc-foo');
    expect(serviceBridgeName('bar-baz')).toBe('nd-svc-bar-baz');
  });
});

describe('ensureServiceBridge', () => {
  it('creates the bridge when missing and attaches Traefik', async () => {
    execState.byArgs.set('docker network ls --filter name=^nd-svc-foo$ --format {{.Name}}', { stdout: '' });
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      stdout: TRAEFIK_NO_BRIDGE,
    });
    const log = vi.fn();
    const name = await ensureServiceBridge('foo', log);
    expect(name).toBe('nd-svc-foo');
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'create'),
    ).toBeDefined();
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
      ),
    ).toBeDefined();
  });

  it('is a no-op when the bridge exists and Traefik is already on it', async () => {
    // Idempotent path: docker `inspect` output preserves the
    // hyphenated bridge name (`"nd-svc-foo"`), so the lib's
    // literal-string search correctly detects the existing
    // membership and skips the re-attach.
    execState.byArgs.set('docker network ls --filter name=^nd-svc-foo$ --format {{.Name}}', { stdout: HAS_ND_SVC });
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      stdout: TRAEFIK_WITH_ND_SVC_FOO,
    });
    const log = vi.fn();
    const name = await ensureServiceBridge('foo', log);
    expect(name).toBe('nd-svc-foo');
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'create'),
    ).toBeUndefined();
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
      ),
    ).toBeUndefined();
  });

  it('attaches Traefik but does not re-create when the bridge exists', async () => {
    execState.byArgs.set('docker network ls --filter name=^nd-svc-foo$ --format {{.Name}}', { stdout: HAS_ND_SVC });
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      stdout: TRAEFIK_NO_BRIDGE,
    });
    await ensureServiceBridge('foo', vi.fn());
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'create'),
    ).toBeUndefined();
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
      ),
    ).toBeDefined();
  });

  it('tolerates a missing Traefik (first-boot) — the next reap picks it up', async () => {
    execState.byArgs.set('docker network ls --filter name=^nd-svc-foo$ --format {{.Name}}', { stdout: '' });
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      throw: new Error('No such container: nd-traefik'),
    });
    const name = await ensureServiceBridge('foo', vi.fn());
    expect(name).toBe('nd-svc-foo');
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'connect'),
    ).toBeUndefined();
  });
});

describe('connectContainerToServiceBridge', () => {
  it('is a no-op when the container is already on the bridge', async () => {
    // Idempotent path: docker `inspect` output preserves the
    // hyphenated network name, so the literal-string search
    // matches and the lib skips the re-attach.
    execState.byArgs.set('docker inspect svc-1 --format {{json .NetworkSettings.Networks}}', {
      stdout: JSON.stringify({ 'nd-svc-foo': {} }),
    });
    await connectContainerToServiceBridge('svc-1', 'foo', vi.fn());
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
      ),
    ).toBeUndefined();
  });

  it('connects a missing container to the bridge', async () => {
    execState.byArgs.set('docker inspect svc-1 --format {{json .NetworkSettings.Networks}}', {
      stdout: TRAEFIK_NO_BRIDGE,
    });
    await connectContainerToServiceBridge('svc-1', 'foo', vi.fn());
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
      ),
    ).toBeDefined();
  });

  it('tolerates a missing container (inspect throws) and tries to connect', async () => {
    execState.byArgs.set('docker inspect svc-1 --format {{json .NetworkSettings.Networks}}', {
      throw: new Error('No such container'),
    });
    await connectContainerToServiceBridge('svc-1', 'foo', vi.fn());
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
      ),
    ).toBeDefined();
  });
});

describe('reapTraefikNetworks', () => {
  it('re-attaches Traefik to every per-slug and compose bridge', async () => {
    execState.byArgs.set('docker network ls --filter name=^nd-svc- --format {{.Name}}', {
      stdout: 'nd-svc-foo\nnd-svc-bar\n',
    });
    execState.byArgs.set('docker network ls --filter name=^ndcmp- --format {{.Name}}', {
      stdout: 'ndcmp-baz_default\n',
    });
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      stdout: JSON.stringify({ 'nd-svc-foo': {} }),
    });
    await reapTraefikNetworks(vi.fn());
    const connects = execState.runCalls
      .filter((c) => c.args[0] === 'network' && c.args[1] === 'connect')
      .map((c) => c.args[2]);
    // `nd-svc-foo` is already a member (idempotent skip); the
    // other two bridges are missing and re-attached.
    expect(connects).toEqual(expect.arrayContaining(['nd-svc-bar', 'ndcmp-baz_default']));
    expect(connects).not.toContain('nd-svc-foo');
  });

  it('tolerates a missing Traefik (inspect throws) and skips the connect', async () => {
    execState.byArgs.set('docker network ls --filter name=^nd-svc- --format {{.Name}}', { stdout: 'nd-svc-foo\n' });
    execState.byArgs.set('docker network ls --filter name=^ndcmp- --format {{.Name}}', { stdout: '' });
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      throw: new Error('No such container'),
    });
    await reapTraefikNetworks(vi.fn());
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'connect'),
    ).toBeUndefined();
  });
});

describe('connectTraefikToComposeNetwork', () => {
  it('attaches Traefik to ndcmp-<slug>_default when missing', async () => {
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      stdout: TRAEFIK_NO_BRIDGE,
    });
    await connectTraefikToComposeNetwork('foo', vi.fn());
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'ndcmp-foo_default',
      ),
    ).toBeDefined();
  });

  it('is a no-op when Traefik is already on ndcmp-<slug>_default', async () => {
    // Docker Compose normalises the project name with underscores
    // in the inspect JSON key, but here the lib creates the
    // network directly via `ndcmp-<slug>_default` (hyphenated), so
    // the inspect JSON key keeps the hyphen. The literal-string
    // search matches and the lib skips the re-attach.
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      stdout: JSON.stringify({ 'ndcmp-foo_default': {} }),
    });
    await connectTraefikToComposeNetwork('foo', vi.fn());
    expect(
      execState.runCalls.find(
        (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'ndcmp-foo_default',
      ),
    ).toBeUndefined();
  });

  it('is a no-op when Traefik is missing (defers to the next reap)', async () => {
    execState.byArgs.set('docker inspect nd-traefik --format {{json .NetworkSettings.Networks}}', {
      throw: new Error('No such container'),
    });
    await connectTraefikToComposeNetwork('foo', vi.fn());
    expect(execState.runCalls).toEqual([]);
  });
});

describe('removeServiceBridgeIfEmpty', () => {
  it('removes the bridge when there are no non-Traefik endpoints', async () => {
    execState.byArgs.set(
      'docker network inspect nd-svc-foo --format {{range .Containers}}{{.Name}} {{end}}',
      { stdout: 'nd-traefik ' },
    );
    const log = vi.fn();
    await removeServiceBridgeIfEmpty('foo', log);
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'rm'),
    ).toBeDefined();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/removed per-service bridge/));
  });

  it('keeps the bridge when a non-Traefik container is still on it', async () => {
    execState.byArgs.set(
      'docker network inspect nd-svc-foo --format {{range .Containers}}{{.Name}} {{end}}',
      { stdout: 'nd-traefik svc-app ' },
    );
    await removeServiceBridgeIfEmpty('foo', vi.fn());
    expect(
      execState.runCalls.find((c) => c.args[0] === 'network' && c.args[1] === 'rm'),
    ).toBeUndefined();
    const ops = execState.runCalls.map((c) => `${c.args[0]}/${c.args[1]}`).join(',');
    expect(ops).toContain('network/disconnect');
    expect(ops).toContain('network/connect');
  });

  it('reconnects Traefik when the network rm throws', async () => {
    execState.byArgs.set(
      'docker network inspect nd-svc-foo --format {{range .Containers}}{{.Name}} {{end}}',
      { stdout: 'nd-traefik ' },
    );
    execState.byArgs.set('docker network rm nd-svc-foo', {
      throw: new Error('bridge has active endpoints'),
    });
    await expect(removeServiceBridgeIfEmpty('foo', vi.fn())).rejects.toThrow(/bridge has active endpoints/);
    const reconnects = execState.runCalls.filter(
      (c) => c.args[0] === 'network' && c.args[1] === 'connect' && c.args[2] === 'nd-svc-foo',
    );
    expect(reconnects.length).toBeGreaterThan(0);
  });
});
