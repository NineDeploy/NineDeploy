import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewer } from '../../src/lib/updateCheck.js';

const feed = (body: unknown, ok = true) =>
  vi.fn(async () => (ok ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 500 }));

describe('isNewer', () => {
  it('compares major, minor and patch (v-prefix optional)', () => {
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('0.1.10', 'v0.1.9')).toBe(true);
    expect(isNewer('v0.1.9', '0.1.9')).toBe(false);
    expect(isNewer('v0.1.8', '0.1.9')).toBe(false);
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
  });
});

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset the module cache between tests so cached results don't leak.
    vi.resetModules();
  });

  it('reports an available update when the feed tag is newer', async () => {
    vi.stubGlobal('fetch', feed({ tag_name: 'v99.0.0', html_url: 'https://x/y' }));
    const { checkForUpdate } = await import('../../src/lib/updateCheck.js');
    const res = await checkForUpdate(true);
    expect(res).toMatchObject({ latest: 'v99.0.0', updateAvailable: true, notesUrl: 'https://x/y' });
    expect(res.current).toBeTruthy();
  });

  it('reports up-to-date when the feed tag is not newer', async () => {
    vi.stubGlobal('fetch', feed({ tag_name: 'v0.0.1' }));
    const { checkForUpdate } = await import('../../src/lib/updateCheck.js');
    expect((await checkForUpdate(true)).updateAvailable).toBe(false);
  });

  it('returns unknown when the feed fails', async () => {
    vi.stubGlobal('fetch', feed({}, false));
    const { checkForUpdate } = await import('../../src/lib/updateCheck.js');
    const res = await checkForUpdate(true);
    expect(res.updateAvailable).toBeNull();
    expect(res.latest).toBeNull();
  });

  it('returns unknown when the feed returns no tag_name', async () => {
    vi.stubGlobal('fetch', feed({}));
    const { checkForUpdate } = await import('../../src/lib/updateCheck.js');
    expect((await checkForUpdate(true)).updateAvailable).toBeNull();
  });

  it('caches results within the TTL', async () => {
    const f = feed({ tag_name: 'v99.0.0' });
    vi.stubGlobal('fetch', f);
    const { checkForUpdate } = await import('../../src/lib/updateCheck.js');
    await checkForUpdate(true);
    await checkForUpdate();
    await checkForUpdate();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns unknown without fetching when checks are disabled', async () => {
    vi.resetModules();
    vi.stubEnv('NINEDEPLOY_UPDATE_CHECK_URL', 'disabled');
    try {
      const f = feed({ tag_name: 'v99.0.0' });
      vi.stubGlobal('fetch', f);
      const { checkForUpdate } = await import('../../src/lib/updateCheck.js');
      const res = await checkForUpdate(true);
      expect(res.updateAvailable).toBeNull();
      expect(f).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
