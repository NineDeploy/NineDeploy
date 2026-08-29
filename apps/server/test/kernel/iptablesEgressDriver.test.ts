import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IptablesEgressDriver } from '../../src/kernel/drivers/iptablesEgressDriver.js';

let runMock: ReturnType<typeof vi.fn>;
let captureMock: ReturnType<typeof vi.fn>;

vi.mock('../../src/lib/exec.js', () => ({
  run: (...args: unknown[]) => runMock(...args),
  capture: (...args: unknown[]) => captureMock(...args),
  buildEnv: (extra?: Record<string, string>) => ({ ...(extra ?? {}) }),
}));

let tmpRoot: string;
let driver: IptablesEgressDriver;

beforeEach(() => {
  runMock = vi.fn().mockResolvedValue(undefined);
  captureMock = vi.fn().mockResolvedValue('172.20.0.0/16\n');
  tmpRoot = mkdtempSync(join(tmpdir(), 'nd-egress-'));
  driver = new IptablesEgressDriver({ rootDir: tmpRoot });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('IptablesEgressDriver', () => {
  it('exposes the stable "iptables" name', () => {
    expect(driver.name).toBe('iptables');
  });

  it('runs iptables -t nat -A POSTROUTING with the SNAT rule', async () => {
    await driver.attach({ projectId: 7 }, '203.0.113.7');
    const call = runMock.mock.calls.find(
      (c) => c[0] === 'iptables' && c[1]?.[0] === '-t' && c[1]?.[1] === 'nat',
    );
    expect(call).toBeDefined();
    const argv = call?.[1] as string[];
    expect(argv).toContain('-A');
    expect(argv).toContain('POSTROUTING');
    expect(argv).toContain('--to-source');
    expect(argv).toContain('203.0.113.7');
    // The comment tag is what makes the rule discoverable for detach.
    expect(argv).toContain('ninedeploy-egress-7');
  });

  it('rejects a non-IPv4 address before touching iptables', async () => {
    await expect(driver.attach({ projectId: 7 }, 'not-an-ip')).rejects.toThrow(/not a valid IPv4/);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('persists the rule to a JSON file under the configured root', async () => {
    await driver.attach({ projectId: 7 }, '203.0.113.7');
    const fs = await import('node:fs');
    const text = fs.readFileSync(join(tmpRoot, '7.rules'), 'utf8');
    const parsed = JSON.parse(text) as { ip: string };
    expect(parsed.ip).toBe('203.0.113.7');
  });

  it('rehydrates from on-disk state on construction', async () => {
    writeFileSync(
      join(tmpRoot, '11.rules'),
      JSON.stringify({
        selector: { projectId: 11 },
        ip: '198.51.100.11',
        createdAt: '2026-08-29T00:00:00.000Z',
      }),
    );
    const fresh = new IptablesEgressDriver({ rootDir: tmpRoot });
    const list = await fresh.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.ip).toBe('198.51.100.11');
  });

  it('is idempotent on the same (projectId, ip)', async () => {
    await driver.attach({ projectId: 7 }, '203.0.113.7');
    runMock.mockClear();
    await driver.attach({ projectId: 7 }, '203.0.113.7');
    // No new iptables call — re-apply is a no-op.
    expect(runMock).not.toHaveBeenCalled();
  });

  it('drops the old rule before applying a different ip for the same project', async () => {
    await driver.attach({ projectId: 7 }, '203.0.113.7');
    await driver.attach({ projectId: 7 }, '198.51.100.7');
    const argvList = runMock.mock.calls.map((c) => c[1] as string[]);
    // First call: -A (attach 203.0.113.7)
    // Second call: -D (detach 203.0.113.7)
    // Third call: -A (attach 198.51.100.7)
    const flags = argvList.map((argv) => argv[argv.indexOf('-A') > -1 ? argv.indexOf('-A') : argv.indexOf('-D')]);
    expect(flags).toEqual(['-A', '-D', '-A']);
  });

  it('detach on an unknown project is a no-op', async () => {
    await driver.detach({ projectId: 999 });
    expect(runMock).not.toHaveBeenCalled();
  });

  it('detach on a known project runs iptables -D and scrubs the rule file', async () => {
    await driver.attach({ projectId: 7 }, '203.0.113.7');
    runMock.mockClear();
    await driver.detach({ projectId: 7 });
    const argv = (runMock.mock.calls[0]?.[1] as string[]) ?? [];
    expect(argv).toContain('-D');
    expect(argv).toContain('--to-source');
    expect(argv).toContain('203.0.113.7');
    const list = await driver.list();
    expect(list).toHaveLength(0);
  });

  it('list returns rules sorted by projectId', async () => {
    await driver.attach({ projectId: 30 }, '198.51.100.30');
    await driver.attach({ projectId: 10 }, '198.51.100.10');
    await driver.attach({ projectId: 20 }, '198.51.100.20');
    const list = await driver.list();
    expect(list.map((r) => r.selector.projectId)).toEqual([10, 20, 30]);
  });
});
