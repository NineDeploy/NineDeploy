import { describe, expect, it, vi } from 'vitest';
import {
  createDynamicPlugin,
  getMarketplaceCatalog,
  installPlugin,
  MARKETPLACE_CATALOG,
  uninstallPlugin,
} from '../../src/kernel/pluginLoader.js';
import { NineDeployKernel } from '../../src/kernel/kernel.js';

describe('PluginLoader', () => {
  const mockDb = {
    query: {
      installedPlugins: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      configEntries: { findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  };

  const mockConfig = {
    port: 3000,
    host: '0.0.0.0',
    jwtSecret: 'test-secret-at-least-32-chars-long-12345',
    dataDir: '/tmp/ninedeploy-test',
  };

  describe('getMarketplaceCatalog', () => {
    it('returns catalog items with isInstalled flag correctly calculated', () => {
      const installed = new Set(['s3-backups', 'redis-sentinel']);
      const catalog = getMarketplaceCatalog(installed);

      expect(catalog).toHaveLength(MARKETPLACE_CATALOG.length);
      const s3 = catalog.find((c) => c.id === 's3-backups');
      const slack = catalog.find((c) => c.id === 'slack-alerts');

      expect(s3?.isInstalled).toBe(true);
      expect(slack?.isInstalled).toBe(false);
    });
  });

  describe('createDynamicPlugin', () => {
    it('creates plugin from marketplace catalog', () => {
      const p = createDynamicPlugin({ source: 'marketplace', target: 's3-backups' });
      expect(p.id).toBe('s3-backups');
      expect(p.name).toBe('Amazon S3 & Cloudflare R2 Sync');
      expect(p.isOfficial).toBe(true);
    });

    it('throws when marketplace item is not found', () => {
      expect(() =>
        createDynamicPlugin({ source: 'marketplace', target: 'non-existent' }),
      ).toThrow('Marketplace plugin "non-existent" not found');
    });

    it('creates plugin from npm package name', () => {
      const p = createDynamicPlugin({
        source: 'npm',
        target: '@ninedeploy/plugin-datadog',
        name: 'Datadog Plugin',
      });
      expect(p.id).toBe('ninedeploy-plugin-datadog');
      expect(p.name).toBe('Datadog Plugin');
    });

    it('creates plugin from git repository url', () => {
      const p = createDynamicPlugin({
        source: 'git',
        target: 'https://github.com/ninedeploy/my-custom-plugin.git',
      });
      expect(p.id).toBe('my-custom-plugin');
    });

    it('creates plugin from local/custom manifest', () => {
      const p = createDynamicPlugin({
        source: 'local',
        target: 'custom-local-plugin',
        name: 'Local Plugin',
        version: '2.0.0',
        description: 'Local dev plugin',
        author: 'Dev',
      });
      expect(p.id).toBe('custom-local-plugin');
      expect(p.version).toBe('2.0.0');
    });
  });

  describe('installPlugin & uninstallPlugin', () => {
    it('installs marketplace plugin into db and registers in kernel', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      mockDb.query.installedPlugins.findFirst.mockResolvedValue(null);

      const res = await installPlugin(mockDb as never, kernel, {
        source: 'marketplace',
        target: 'slack-alerts',
      });

      expect(res).toEqual({ ok: true, id: 'slack-alerts', status: 'active' });
      expect(kernel.getPlugin('slack-alerts')).toBeDefined();

      // Test init callback
      const dynamic = kernel.getPlugin('slack-alerts')!;
      await dynamic.init(kernel);
      if (dynamic.destroy) await dynamic.destroy(kernel);
    });

    it('rejects installation if plugin is already active in kernel', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      mockDb.query.installedPlugins.findFirst.mockResolvedValue({ id: 'slack-alerts', enabled: true });

      // Pre-register
      await kernel.registerPlugin({
        id: 'slack-alerts',
        name: 'Slack Alerts',
        version: '1.0.0',
        init: vi.fn(),
      });

      await expect(
        installPlugin(mockDb as never, kernel, { source: 'marketplace', target: 'slack-alerts' }),
      ).rejects.toThrow('Plugin "slack-alerts" is already installed and active');
    });

    it('uninstalls plugin and purges runtime components', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      const destroySpy = vi.fn();

      await kernel.registerPlugin({
        id: 'to-remove',
        name: 'To Remove',
        version: '1.0.0',
        init: vi.fn(),
        destroy: destroySpy,
      });

      mockDb.query.installedPlugins.findFirst.mockResolvedValue({ id: 'to-remove' });

      const res = await uninstallPlugin(mockDb as never, kernel, 'to-remove');
      expect(res).toEqual({ ok: true, id: 'to-remove' });
      expect(destroySpy).toHaveBeenCalled();
    });

    it('handles uninstall error inside destroy without failing uninstall', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await kernel.registerPlugin({
        id: 'boom-plugin',
        name: 'Boom',
        version: '1.0.0',
        init: vi.fn(),
        destroy: vi.fn().mockRejectedValue(new Error('Destroy failure')),
      });

      mockDb.query.installedPlugins.findFirst.mockResolvedValue({ id: 'boom-plugin' });

      const res = await uninstallPlugin(mockDb as never, kernel, 'boom-plugin');
      expect(res.ok).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('creates plugin from git repository without slash in url', () => {
      const p = createDynamicPlugin({
        source: 'git',
        target: 'plain-git-repo',
      });
      expect(p.id).toBe('plain-git-repo');
    });

    it('installs when plugin is already present in kernel (re-enabling)', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      await kernel.registerPlugin({
        id: 'existing-plugin',
        name: 'Existing',
        version: '1.0.0',
        init: vi.fn(),
      });

      // existing in DB but enabled=false
      mockDb.query.installedPlugins.findFirst.mockResolvedValue({ id: 'existing-plugin', enabled: false });

      const res = await installPlugin(mockDb as never, kernel, {
        source: 'local',
        target: 'existing-plugin',
      });
      expect(res.ok).toBe(true);
    });

    it('uninstalls plugin when plugin is in kernel without destroy method or not in kernel', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);

      // Plugin without destroy method
      await kernel.registerPlugin({
        id: 'no-destroy',
        name: 'No Destroy',
        version: '1.0.0',
        init: vi.fn(),
      });

      mockDb.query.installedPlugins.findFirst.mockResolvedValue({ id: 'no-destroy' });
      const res1 = await uninstallPlugin(mockDb as never, kernel, 'no-destroy');
      expect(res1.ok).toBe(true);

      // Plugin in DB but not loaded in kernel
      mockDb.query.installedPlugins.findFirst.mockResolvedValue({ id: 'db-only' });
      const res2 = await uninstallPlugin(mockDb as never, kernel, 'db-only');
      expect(res2.ok).toBe(true);
    });

    it('throws when uninstalling a non-installed plugin', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      mockDb.query.installedPlugins.findFirst.mockResolvedValue(null);

      await expect(uninstallPlugin(mockDb as never, kernel, 'ghost-plugin')).rejects.toThrow(
        'Plugin "ghost-plugin" is not installed',
      );
    });
  });

  describe('loadInstalledPlugins', () => {
    it('restores all enabled plugins from database and handles registration failures gracefully', async () => {
      const { loadInstalledPlugins } = await import('../../src/kernel/pluginLoader.js');
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // 1. Pre-load one plugin so it gets skipped
      await kernel.registerPlugin({
        id: 'already-loaded',
        name: 'Already Loaded',
        version: '1.0.0',
        init: () => {},
      });

      mockDb.query.installedPlugins.findMany.mockResolvedValue([
        {
          id: 'already-loaded',
          name: 'Already Loaded',
          version: '1.0.0',
          enabled: true,
          manifest: { source: 'local', target: 'already-loaded' },
        },
        {
          id: 's3-backups',
          name: 'S3 Sync',
          version: '1.1.0',
          enabled: true,
          isOfficial: true,
          manifest: {}, // triggers source: 'marketplace' and target: 's3-backups'
        },
        {
          id: 'custom-untyped',
          name: 'Custom Untyped',
          version: '1.0.0',
          description: 'Custom untyped plugin',
          author: 'Alice',
          icon: 'Sparkles',
          enabled: true,
          isOfficial: false,
          manifest: null, // triggers manifest || {} and fallback source: 'local', target: 'custom-untyped'
        },
        {
          id: 'broken-plugin',
          name: 'Broken',
          version: '1.0.0',
          enabled: true,
          manifest: { source: 'marketplace', target: 'non-existent-item' },
        },
      ]);

      const count = await loadInstalledPlugins(mockDb as never, kernel);
      expect(count).toBe(2); // s3-backups and custom-untyped freshly loaded
      expect(kernel.getPlugin('s3-backups')).toBeDefined();
      expect(kernel.getPlugin('custom-untyped')).toBeDefined();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
