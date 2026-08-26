import { describe, expect, it, vi } from 'vitest';
import {
  connectContainerToServiceBridge,
  ensureServiceBridge,
  reapTraefikNetworks,
  removeServiceBridgeIfEmpty,
  serviceBridgeName,
} from '../../src/lib/serviceBridge.js';

const h = vi.hoisted(() => {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const outputs = new Map<string, string>();
  const run = vi.fn(async (_cmd: string, args: unknown[]) => {
    calls.push({ cmd: 'run', args: args as string[] });
  });
  const capture = vi.fn(async (_cmd: string, args: unknown[]) => {
    calls.push({ cmd: 'capture', args: args as string[] });
    const key = (args as string[]).join(' ');
    return outputs.get(key) ?? '';
  });
  return { calls, outputs, run, capture };
});

vi.mock('../../src/lib/exec.js', () => ({ run: h.run, capture: h.capture, sleep: async () => undefined, buildEnv: () => ({}) }));

function seedLs(name: string, present: boolean): void {
  h.outputs.set(`network ls --filter name=^${name}$ --format {{.Name}}`, present ? name : '');
}
function seedInspect(container: string, networksJson: string): void {
  h.outputs.set(`inspect ${container} --format {{json .NetworkSettings.Networks}}`, networksJson);
}
function lastCall(): { cmd: string; args: string[] } {
  return h.calls[h.calls.length - 1]!;
}

describe('serviceBridge', () => {
  it('naming is canonical and stable', () => {
    expect(serviceBridgeName('my-app')).toBe('nd-svc-my-app');
  });

  it('ensureServiceBridge creates the bridge and attaches Traefik on first call', async () => {
    h.calls.length = 0;
    seedLs('nd-svc-my-app', false);
    seedInspect('ninedeploy-traefik', '{}');
    const name = await ensureServiceBridge('my-app', () => undefined);
    expect(name).toBe('nd-svc-my-app');
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network create nd-svc-my-app')).toBe(true);
    expect(argvStrings.some((s) => s === 'network connect nd-svc-my-app ninedeploy-traefik')).toBe(true);
  });

  it('ensureServiceBridge is a no-op when the bridge and Traefik attachment already exist', async () => {
    h.calls.length = 0;
    seedLs('nd-svc-my-app', true);
    seedInspect('ninedeploy-traefik', '{"nd-svc-my-app":{}}');
    await ensureServiceBridge('my-app', () => undefined);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network create nd-svc-my-app')).toBe(false);
    expect(argvStrings.some((s) => s === 'network connect nd-svc-my-app ninedeploy-traefik')).toBe(false);
  });

  it('connectContainerToServiceBridge is idempotent on the same container', async () => {
    h.calls.length = 0;
    seedInspect('nd-db-pg-1', '{"nd-svc-my-app":{}}');
    await connectContainerToServiceBridge('nd-db-pg-1', 'my-app', () => undefined);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network connect nd-svc-my-app nd-db-pg-1')).toBe(false);
  });

  it('connectContainerToServiceBridge connects a fresh container', async () => {
    h.calls.length = 0;
    seedInspect('nd-db-pg-1', '{}');
    await connectContainerToServiceBridge('nd-db-pg-1', 'my-app', () => undefined);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network connect nd-svc-my-app nd-db-pg-1')).toBe(true);
  });

  it('reapTraefikNetworks connects Traefik to every per-slug bridge it is missing from', async () => {
    h.calls.length = 0;
    h.outputs.set('network ls --filter name=^nd-svc- --format {{.Name}}', 'nd-svc-app-1\nnd-svc-app-2');
    seedInspect('ninedeploy-traefik', '{"nd-svc-app-1":{}}'); // not on app-2
    await reapTraefikNetworks(() => undefined);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network connect nd-svc-app-2 ninedeploy-traefik')).toBe(true);
    expect(argvStrings.some((s) => s === 'network connect nd-svc-app-1 ninedeploy-traefik')).toBe(false);
  });

  it('removeServiceBridgeIfEmpty removes the bridge when only Traefik is attached', async () => {
    h.calls.length = 0;
    h.outputs.set(
      'network inspect nd-svc-my-app --format {{range .Containers}}{{.Name}} {{end}}',
      'ninedeploy-traefik ',
    );
    await removeServiceBridgeIfEmpty('my-app', () => undefined);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network disconnect nd-svc-my-app ninedeploy-traefik')).toBe(true);
    expect(argvStrings.some((s) => s === 'network rm nd-svc-my-app')).toBe(true);
  });

  it('removeServiceBridgeIfEmpty keeps the bridge and reattaches Traefik when a service is still on it', async () => {
    h.calls.length = 0;
    h.outputs.set(
      'network inspect nd-svc-my-app --format {{range .Containers}}{{.Name}} {{end}}',
      'ninedeploy-traefik my-app-42 ',
    );
    await removeServiceBridgeIfEmpty('my-app', () => undefined);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network disconnect nd-svc-my-app ninedeploy-traefik')).toBe(true);
    expect(argvStrings.some((s) => s === 'network rm nd-svc-my-app')).toBe(false);
    // Reattach Traefik so subsequent deploys do not lose routing.
    expect(argvStrings.some((s) => s === 'network connect nd-svc-my-app ninedeploy-traefik')).toBe(true);
  });

  it('removeServiceBridgeIfEmpty reattaches Traefik on rm failure so routing is not left half-broken', async () => {
    h.calls.length = 0;
    h.outputs.set(
      'network inspect nd-svc-my-app --format {{range .Containers}}{{.Name}} {{end}}',
      'ninedeploy-traefik ',
    );
    // Replace the impl to fail network rm. The default impl only records the
    // call, so we switch to one that throws on the rm call and resets after.
    let nextIsRm = false;
    h.run.mockImplementation(async (_cmd, args) => {
      h.calls.push({ cmd: 'run', args: args as string[] });
      if (nextIsRm) throw new Error('bridge busy');
    });
    // Schedule the next run call to be the rm: we issue a sentinel capture call
    // first, then on the next run the override fires. We do this by hooking
    // into capture: when the network-inspect capture runs, the very next run
    // call is the rm.
    const origCapture = h.capture.getMockImplementation()!;
    h.capture.mockImplementation(async (cmd, args) => {
      const out = await origCapture(cmd as string, args as unknown[]);
      if ((args as string[]).join(' ').includes('network inspect nd-svc-my-app')) {
        nextIsRm = true;
      }
      return out;
    });
    await expect(removeServiceBridgeIfEmpty('my-app', () => undefined)).rejects.toThrow(/bridge busy/);
    const argvStrings = h.calls.map((c) => c.args.join(' '));
    expect(argvStrings.some((s) => s === 'network connect nd-svc-my-app ninedeploy-traefik')).toBe(true);
    // lastCall sanity: the reattach was issued.
    expect(lastCall().args.join(' ')).toBe('network connect nd-svc-my-app ninedeploy-traefik');
  });
});
