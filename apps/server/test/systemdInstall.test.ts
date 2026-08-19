import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('bare-metal systemd installation policy', () => {
  it('ships a simple service with watchdog supervision explicitly disabled', () => {
    const unit = rootFile('systemd/ninedeploy.service');

    expect(unit).toMatch(/^Type=simple$/m);
    expect(unit).toMatch(/^WatchdogSec=0$/m);
    expect(unit).not.toMatch(/^Type=notify$/m);
  });

  it('migrates stale watchdog installations and verifies effective settings', () => {
    const installer = rootFile('install.sh');

    expect(installer).toContain('99-ninedeploy-runtime-safety.conf');
    expect(installer).toContain("'Type=simple'");
    expect(installer).toContain("'WatchdogSec=0'");
    expect(installer).toContain('EFFECTIVE_TYPE=$(systemctl show ninedeploy --property=Type --value)');
    expect(installer).toContain('EFFECTIVE_WATCHDOG=$(systemctl show ninedeploy --property=WatchdogUSec --value)');
  });

  it('does not retain the broken runtime sd_notify client', () => {
    expect(rootFile('apps/server/src/server.ts')).not.toContain('sdNotify');
    expect(rootFile('apps/server/src/agent.ts')).not.toContain('sdNotify');
  });
});
