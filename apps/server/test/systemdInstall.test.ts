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

    expect(installer).toContain('zzzz-ninedeploy-runtime-safety.conf');
    expect(installer).toContain('DATA_DIR=$(cd "$DATA_DIR_SETTING" && pwd -P)');
    expect(installer).toContain("'Type=simple'");
    expect(installer).toContain("'WatchdogSec=0'");
    expect(installer).toContain('EFFECTIVE_TYPE=$(systemctl show ninedeploy --property=Type --value)');
    expect(installer).toContain('EFFECTIVE_WATCHDOG=$(systemctl show ninedeploy --property=WatchdogUSec --value)');
  });

  it('does not retain the broken runtime sd_notify client', () => {
    expect(rootFile('apps/server/src/server.ts')).not.toContain('sdNotify');
    expect(rootFile('apps/server/src/agent.ts')).not.toContain('sdNotify');
  });

  it('reuses a verified Traefik image or falls back immediately without mutating Docker state', () => {
    const installer = rootFile('install.sh');

    expect(installer).toContain('traefik_image_usable');
    expect(installer).toContain('Existing Traefik v3 image verified; skipping registry pull');
    expect(installer).toContain('PULL_OUTPUT=$(docker pull traefik:3 2>&1)');
    expect(installer).toContain('switching immediately to the verified layer-free Traefik image');
    expect(installer).toContain('build_traefik_fallback_image');
    expect(installer).toContain('checksums.txt');
    expect(installer).toContain('ACTUAL_SHA=$(sha256sum');
    expect(installer).toContain("--change 'ENTRYPOINT [\"/traefik\"]'");
    expect(installer).toContain('docker run --rm traefik:3 version');
    expect(installer).not.toContain('sudo systemctl restart docker');
    expect(installer).not.toContain('docker image prune');
    expect(installer).not.toContain('ctr --namespace moby snapshots');
  });
});
