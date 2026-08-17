import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../src/routes/settings/index.js';
import { ConfigCenterSection } from '../src/routes/settings/ConfigCenterSection.js';
import { PluginsSection } from '../src/routes/settings/PluginsSection.js';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/lib/auth.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

vi.mock('../src/lib/auth.js', async () => {
  const { createAuthMock } = await import('./helpers.js');
  return createAuthMock();
});

const sampleConfigEntries = [
  {
    key: 'system.site_name',
    pluginId: null,
    type: 'string' as const,
    isSecret: false,
    label: 'Site Name',
    category: 'general',
    description: 'Instance Display Name',
    tags: ['branding', 'system'],
    value: 'NineDeploy Production',
    isConfigured: true,
    updatedAt: '2026-08-17T12:00:00.000Z',
  },
  {
    key: 'system.max_memory_mb',
    pluginId: null,
    type: 'number' as const,
    isSecret: false,
    label: 'Max Memory',
    category: 'resources',
    description: 'Host memory cap',
    tags: ['memory', 'limits'],
    value: 4096,
    isConfigured: true,
    updatedAt: '2026-08-17T12:00:00.000Z',
  },
  {
    key: 'system.json_meta',
    pluginId: null,
    type: 'json' as const,
    isSecret: false,
    label: 'JSON Meta',
    category: 'general',
    tags: [],
    value: { region: 'eu-central' },
    isConfigured: true,
  },
  {
    key: 'system.bool_flag',
    pluginId: null,
    type: 'boolean' as const,
    isSecret: false,
    label: 'Feature Flag',
    category: 'general',
    tags: [],
    value: true,
    isConfigured: true,
  },
  {
    key: 'system.null_value',
    pluginId: null,
    type: 'string' as const,
    isSecret: false,
    label: 'Null Value',
    category: 'general',
    tags: [],
    value: null,
    isConfigured: true,
  },
  {
    key: 'plugin:smtp:password',
    pluginId: 'smtp',
    type: 'string' as const,
    isSecret: true,
    label: 'SMTP Password',
    category: 'plugin:smtp',
    description: 'Encrypted relay credentials',
    tags: ['email', 'auth'],
    value: '••••••••',
    isConfigured: true,
    updatedAt: '2026-08-17T12:00:00.000Z',
  },
  {
    key: 'system.default_setting',
    pluginId: null,
    type: 'string' as const,
    isSecret: false,
    label: 'Default Setting',
    category: 'general',
    tags: [],
    value: 'Default Value',
    isConfigured: false,
  },
];

const samplePlugins = [
  {
    id: 'traefik-proxy',
    name: 'Traefik Dynamic Proxy',
    version: '2.11.0',
    description: 'Reverse proxy and automatic TLS ingress provider',
    isOfficial: true,
    enabled: true,
    status: 'active' as const,
    dependencies: [],
  },
  {
    id: 'smtp-notifier',
    name: 'SMTP Email Delivery',
    version: '1.0.4',
    description: 'Sends email alerts via SMTP relay',
    isOfficial: false,
    enabled: false,
    status: 'disabled' as const,
    dependencies: ['notifications-core'],
  },
  {
    id: 'errored-plugin',
    name: 'Broken Plugin',
    version: '0.1.0',
    description: 'Fails to boot',
    isOfficial: false,
    enabled: false,
    status: 'errored' as const,
    error: 'Fatal crash on init: missing required socket',
  },
];

describe('Config Center & Plugins Frontend Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(useAuth).mockReturnValue({
      user: { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' },
      loading: false,
      login: vi.fn(),
      setup: vi.fn(),
      logout: vi.fn(),
      loginWithPasskey: vi.fn(),
    });
    mockOf(api.auth.me).mockResolvedValue({ id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin' });
    mockOf(api.config.list).mockResolvedValue({ entries: sampleConfigEntries });
    mockOf(api.config.set).mockResolvedValue({ ok: true, key: 'system.site_name' });
    mockOf(api.config.delete).mockResolvedValue({ ok: true, key: 'system.site_name' });
    mockOf(api.plugins.list).mockResolvedValue({ plugins: samplePlugins });
    mockOf(api.plugins.enable).mockResolvedValue({ ok: true, id: 'smtp-notifier', status: 'active' });
    mockOf(api.plugins.disable).mockResolvedValue({ ok: true, id: 'traefik-proxy', status: 'disabled' });
  });

  describe('ConfigCenterSection', () => {
    it('renders config entries, handles reveal toggle, search and category filters', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
        expect(screen.getByText('NineDeploy Production')).toBeInTheDocument();
        expect(screen.getByText('plugin:smtp:password')).toBeInTheDocument();
        expect(screen.getByText('••••••••')).toBeInTheDocument();
      });

      // Filter by category
      const resourcesPill = screen.getByRole('button', { name: 'resources' });
      await user.click(resourcesPill);

      expect(screen.getByText('system.max_memory_mb')).toBeInTheDocument();
      expect(screen.queryByText('system.site_name')).not.toBeInTheDocument();

      // Reset to all
      const allPill = screen.getByRole('button', { name: 'all' });
      await user.click(allPill);
      expect(screen.getByText('system.site_name')).toBeInTheDocument();

      // Search by tag
      const searchInput = screen.getByPlaceholderText('Search keys, labels, tags...');
      await user.type(searchInput, 'email');
      expect(screen.getByText('plugin:smtp:password')).toBeInTheDocument();
      expect(screen.queryByText('system.site_name')).not.toBeInTheDocument();

      // Empty search state
      await user.clear(searchInput);
      await user.type(searchInput, 'nonexistent-query-12345');
      expect(screen.getByText('No configuration entries found matching your filters.')).toBeInTheDocument();
      await user.clear(searchInput);

      // Reveal secrets toggle
      const revealBtn = screen.getByRole('button', { name: /reveal secrets/i });
      await user.click(revealBtn);
      await waitFor(() => {
        expect(mockOf(api.config.list)).toHaveBeenCalledWith({ reveal: true });
      });

      // Refresh button
      const refreshBtn = screen.getByLabelText('Refresh config');
      await user.click(refreshBtn);
      await waitFor(() => {
        expect(mockOf(api.config.list)).toHaveBeenCalled();
      });
    });

    it('creates a new configuration entry via modal', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('New Setting')).toBeInTheDocument();
      });

      await user.click(screen.getByText('New Setting'));
      expect(screen.getByText('Create Configuration Key')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('e.g. system.custom_timeout or plugin:my-plugin:api_key'), { target: { value: 'custom.my_key' } });
      fireEvent.change(screen.getByPlaceholderText('Setting value'), { target: { value: 'my-val' } });
      fireEvent.change(screen.getByPlaceholderText('Brief description of this setting'), { target: { value: 'My Description' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. timeout, critical, cloudflare'), { target: { value: 'tag1, tag2' } });
      fireEvent.click(screen.getByRole('checkbox'));

      fireEvent.click(screen.getByRole('button', { name: /create setting/i }));

      await waitFor(() => {
        expect(mockOf(api.config.set)).toHaveBeenCalledWith('custom.my_key', {
          value: 'my-val',
          isSecret: true,
          description: 'My Description',
          tags: ['tag1', 'tag2'],
        });
      });
    });

    it('edits config entries of various types (string, number, boolean, json)', async () => {
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
      });

      // 1. Edit string
      let editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[0]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.site_name')).toBeInTheDocument();
      });
      const input = screen.getByDisplayValue('NineDeploy Production');
      fireEvent.change(input, { target: { value: 'NineDeploy Updated' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => {
        expect(mockOf(api.config.set)).toHaveBeenCalledWith('system.site_name', {
          value: 'NineDeploy Updated',
          isSecret: false,
          description: 'Instance Display Name',
          tags: ['branding', 'system'],
        });
      });

      // 2. Edit number
      await waitFor(() => expect(screen.queryByText('Edit Config: system.site_name')).not.toBeInTheDocument());
      editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[1]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.max_memory_mb')).toBeInTheDocument();
      });
      const numInput = screen.getByDisplayValue('4096');
      fireEvent.change(numInput, { target: { value: '8192' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => {
        expect(mockOf(api.config.set)).toHaveBeenCalledWith('system.max_memory_mb', expect.objectContaining({ value: 8192 }));
      });

      // 3. Edit JSON (with invalid alert and valid json)
      await waitFor(() => expect(screen.queryByText('Edit Config: system.max_memory_mb')).not.toBeInTheDocument());
      const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
      editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[2]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.json_meta')).toBeInTheDocument();
      });
      const jsonInput = screen.getByDisplayValue(JSON.stringify({ region: 'eu-central' }));
      fireEvent.change(jsonInput, { target: { value: '{invalid-json' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      expect(alertMock).toHaveBeenCalledWith('Invalid JSON format');

      fireEvent.change(jsonInput, { target: { value: '{"region":"us-east"}' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => {
        expect(mockOf(api.config.set)).toHaveBeenCalledWith('system.json_meta', expect.objectContaining({ value: { region: 'us-east' } }));
      });
      alertMock.mockRestore();

      // 4. Edit boolean
      await waitFor(() => expect(screen.queryByText('Edit Config: system.json_meta')).not.toBeInTheDocument());
      editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[3]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.bool_flag')).toBeInTheDocument();
      });
      const boolInput = screen.getByDisplayValue('true');
      fireEvent.change(boolInput, { target: { value: 'false' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => {
        expect(mockOf(api.config.set)).toHaveBeenCalledWith('system.bool_flag', expect.objectContaining({ value: false }));
      });

      // 5. Edit null value entry
      await waitFor(() => expect(screen.queryByText('Edit Config: system.bool_flag')).not.toBeInTheDocument());
      editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[4]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.null_value')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      // 6. Edit secret while masked (revealSecrets is false)
      await waitFor(() => expect(screen.queryByText('Edit Config: system.null_value')).not.toBeInTheDocument());
      editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[5]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: plugin:smtp:password')).toBeInTheDocument();
      });
      const maskedInput = screen.getByPlaceholderText('Enter value');
      expect(maskedInput).toHaveAttribute('type', 'password');
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    it('deletes config entry with confirmation', async () => {
      const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
      });

      const deleteBtns = screen.getAllByTitle('Delete');
      fireEvent.click(deleteBtns[0]!);

      expect(confirmMock).toHaveBeenCalled();
      await waitFor(() => {
        expect(mockOf(api.config.delete)).toHaveBeenCalledWith('system.site_name');
      });
      confirmMock.mockRestore();
    });
  });

  describe('PluginsSection', () => {
    const sampleCatalog = [
      {
        id: 's3-backups',
        name: 'Amazon S3 & Cloudflare R2 Sync',
        version: '1.1.0',
        description: 'Automated backup replication',
        author: 'NineDeploy Official',
        category: 'storage',
        isOfficial: true,
        isInstalled: false,
      },
      {
        id: 'discord-alerts',
        name: 'Discord Webhook Notifier',
        version: '1.0.0',
        description: 'Sends rich embeds to Discord',
        author: 'Community',
        category: 'notifications',
        isOfficial: false,
        isInstalled: true,
      },
    ];

    beforeEach(() => {
      mockOf(api.plugins.marketplace).mockResolvedValue({ catalog: sampleCatalog });
      mockOf(api.plugins.install).mockResolvedValue({ ok: true, id: 's3-backups', status: 'active' });
      mockOf(api.plugins.uninstall).mockResolvedValue({ ok: true, id: 'smtp-notifier' });
    });

    it('renders plugin items, official/community badges, toggles enable/disable, and uninstalls', async () => {
      const user = userEvent.setup();
      const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);

      renderWithProviders(<PluginsSection />);

      await waitFor(() => {
        expect(screen.getByText('Traefik Dynamic Proxy')).toBeInTheDocument();
        expect(screen.getByText('SMTP Email Delivery')).toBeInTheDocument();
        expect(screen.getByText('Broken Plugin')).toBeInTheDocument();
        expect(screen.getByText(/Official/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Community/i)).toHaveLength(2);
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Disabled')).toBeInTheDocument();
        expect(screen.getByText('Errored')).toBeInTheDocument();
        expect(screen.getByText('Fatal crash on init: missing required socket')).toBeInTheDocument();
        expect(screen.getByText('notifications-core')).toBeInTheDocument();
      });

      // Disable active plugin
      const disableBtn = screen.getByRole('button', { name: /disable/i });
      await user.click(disableBtn);
      expect(mockOf(api.plugins.disable)).toHaveBeenCalledWith('traefik-proxy');

      // Enable disabled plugin
      const enableBtns = screen.getAllByRole('button', { name: /enable/i });
      await user.click(enableBtns[0]!);
      expect(mockOf(api.plugins.enable)).toHaveBeenCalledWith('smtp-notifier');

      // Refresh
      const refreshBtn = screen.getByLabelText('Refresh plugins');
      await user.click(refreshBtn);
      expect(mockOf(api.plugins.list)).toHaveBeenCalled();

      // Uninstall non-official plugin with confirm true
      const uninstallBtns = screen.getAllByTitle('Uninstall Plugin');
      expect(uninstallBtns.length).toBeGreaterThan(0);
      await user.click(uninstallBtns[0]!);
      expect(confirmMock).toHaveBeenCalled();
      expect(mockOf(api.plugins.uninstall)).toHaveBeenCalledWith('smtp-notifier');

      // Cancel uninstall when confirm is false
      confirmMock.mockReturnValue(false);
      await user.click(uninstallBtns[0]!);
      expect(mockOf(api.plugins.uninstall)).toHaveBeenCalledTimes(1);

      confirmMock.mockRestore();
    });

    it('handles marketplace installation flow and modal tabs', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PluginsSection />);

      await waitFor(() => {
        expect(screen.getByText('Install Plugin')).toBeInTheDocument();
      });

      // Open install modal
      await user.click(screen.getByText('Install Plugin'));
      await waitFor(() => {
        expect(screen.getByText('Marketplace Catalog')).toBeInTheDocument();
        expect(screen.getByText('Amazon S3 & Cloudflare R2 Sync')).toBeInTheDocument();
        expect(screen.getByText('Discord Webhook Notifier')).toBeInTheDocument();
        expect(screen.getByText('Installed')).toBeInTheDocument();
      });

      // Filter by category chip
      const storageChip = screen.getByRole('button', { name: 'storage' });
      await user.click(storageChip);
      expect(screen.getByText('Amazon S3 & Cloudflare R2 Sync')).toBeInTheDocument();
      expect(screen.queryByText('Discord Webhook Notifier')).not.toBeInTheDocument();

      // Reset to all categories
      const allCatChip = screen.getByRole('button', { name: 'all' });
      await user.click(allCatChip);
      expect(screen.getByText('Discord Webhook Notifier')).toBeInTheDocument();

      // Search filtering
      const mktSearchInput = screen.getByPlaceholderText('Search plugins by name, keyword, or author...');
      fireEvent.change(mktSearchInput, { target: { value: 'Discord' } });
      expect(screen.getByText('Discord Webhook Notifier')).toBeInTheDocument();
      expect(screen.queryByText('Amazon S3 & Cloudflare R2 Sync')).not.toBeInTheDocument();

      // No match search state
      fireEvent.change(mktSearchInput, { target: { value: 'nonexistent_plugin_xyz' } });
      expect(screen.getByText('No plugins match your filter criteria.')).toBeInTheDocument();

      // Clear search
      fireEvent.change(mktSearchInput, { target: { value: '' } });
      expect(screen.getByText('Amazon S3 & Cloudflare R2 Sync')).toBeInTheDocument();

      // Install s3-backups from marketplace
      const installBtn = screen.getByRole('button', { name: /^Install$/ });
      await user.click(installBtn);
      await waitFor(() => {
        expect(mockOf(api.plugins.install)).toHaveBeenCalledWith({
          source: 'marketplace',
          target: 's3-backups',
        });
      });

      // Re-open and test custom package tab
      await user.click(screen.getByText('Install Plugin'));
      await waitFor(() => {
        expect(screen.getByText('Custom Package / Repo')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Custom Package / Repo'));

      // Switch back to marketplace tab and back to custom
      await user.click(screen.getByText('Marketplace Catalog'));
      await waitFor(() => {
        expect(screen.getByText('Amazon S3 & Cloudflare R2 Sync')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Custom Package / Repo'));

      // Switch source types
      await user.click(screen.getByRole('button', { name: 'GIT' }));
      expect(screen.getByText('Git Repository URL')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'LOCAL' }));
      expect(screen.getByText('Local Directory Path')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'NPM' }));
      expect(screen.getByText('NPM Package Name')).toBeInTheDocument();

      // Test Cancel button
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByText('Custom Package / Repo')).not.toBeInTheDocument();
      });

      // Re-open and test close via dialog X button
      await user.click(screen.getByRole('button', { name: 'Install Plugin' }));
      await waitFor(() => {
        expect(screen.getByText('Marketplace Catalog')).toBeInTheDocument();
      });
      const closeBtns = screen.getAllByLabelText('Close dialog');
      await user.click(closeBtns[0]!);
      await waitFor(() => {
        expect(screen.queryByText('Marketplace Catalog')).not.toBeInTheDocument();
      });

      // Re-open and submit custom install
      await user.click(screen.getByRole('button', { name: 'Install Plugin' }));
      await waitFor(() => {
        expect(screen.getByText('Custom Package / Repo')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Custom Package / Repo'));

      // Fill custom inputs
      const targetInput = screen.getByPlaceholderText('e.g. @ninedeploy-plugin/datadog-tracer');
      fireEvent.change(targetInput, { target: { value: '@ninedeploy/plugin-custom' } });

      const nameInput = screen.getByPlaceholderText('My Custom Plugin');
      fireEvent.change(nameInput, { target: { value: 'Custom Plugin' } });

      const versionInput = screen.getByPlaceholderText('1.0.0');
      fireEvent.change(versionInput, { target: { value: '2.1.0' } });

      const descInput = screen.getByPlaceholderText('Brief description of this extension');
      fireEvent.change(descInput, { target: { value: 'Awesome custom plugin' } });

      // Click Install Extension
      await user.click(screen.getByRole('button', { name: /install extension/i }));
      await waitFor(() => {
        expect(mockOf(api.plugins.install)).toHaveBeenCalledWith({
          source: 'npm',
          target: '@ninedeploy/plugin-custom',
          name: 'Custom Plugin',
          version: '2.1.0',
          description: 'Awesome custom plugin',
        });
      });

      // Re-open and test install with empty optional fields
      await user.click(screen.getByRole('button', { name: 'Install Plugin' }));
      await waitFor(() => {
        expect(screen.getByText('Custom Package / Repo')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Custom Package / Repo'));
      const targetInput2 = screen.getByPlaceholderText('e.g. @ninedeploy-plugin/datadog-tracer');
      fireEvent.change(targetInput2, { target: { value: 'minimal-plugin' } });
      const versionInput2 = screen.getByPlaceholderText('1.0.0');
      fireEvent.change(versionInput2, { target: { value: '   ' } }); // blank version
      await user.click(screen.getByRole('button', { name: /install extension/i }));
      await waitFor(() => {
        expect(mockOf(api.plugins.install)).toHaveBeenCalledWith({
          source: 'npm',
          target: 'minimal-plugin',
          name: undefined,
          version: undefined,
          description: undefined,
        });
      });
    });

    it('renders empty marketplace catalog when catalog is empty', async () => {
      const user = userEvent.setup();
      mockOf(api.plugins.marketplace).mockResolvedValue({ catalog: [] });
      renderWithProviders(<PluginsSection />);

      await waitFor(() => {
        expect(screen.getByText('Install Plugin')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Install Plugin'));
      await waitFor(() => {
        expect(screen.getByText('Catalog is currently unavailable.')).toBeInTheDocument();
      });
    });

    it('renders empty plugins and loading state and opens marketplace on click', async () => {
      const user = userEvent.setup();
      mockOf(api.plugins.list).mockResolvedValue({ plugins: [] });
      renderWithProviders(<PluginsSection />);

      await waitFor(() => {
        expect(screen.getByText(/No plugins installed/i)).toBeInTheDocument();
      });

      const browseBtn = screen.getByRole('button', { name: /browse marketplace/i });
      await user.click(browseBtn);
      await waitFor(() => {
        expect(screen.getByText('Marketplace Catalog')).toBeInTheDocument();
      });
    });

    it('renders for non-admin member without admin action buttons and inspects without hot reload', async () => {
      const user = userEvent.setup();
      mockOf(useAuth).mockReturnValue({
        user: { id: 2, email: 'member@test.com', name: 'Member', role: 'member' },
        loading: false,
        login: vi.fn(),
        setup: vi.fn(),
        logout: vi.fn(),
        loginWithPasskey: vi.fn(),
      });
      mockOf(api.plugins.inspect).mockResolvedValue({
        id: 'traefik-proxy',
        name: 'Traefik Dynamic Proxy',
        version: '2.11.0',
        description: 'Reverse proxy and automatic TLS ingress provider',
        author: 'NineDeploy Team',
        isOfficial: true,
        enabled: true,
        status: 'active',
        dependencies: [],
        hooks: [],
        services: [],
        menus: [],
        configSchema: [],
        error: null,
        runtimeStats: { eventsHandled: 1, uptimeSeconds: 10 },
      });

      renderWithProviders(<PluginsSection />);
      await waitFor(() => {
        expect(screen.getByText('Traefik Dynamic Proxy')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /disable/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Install Plugin' })).not.toBeInTheDocument();

      const inspectBtns = screen.getAllByRole('button', { name: /inspect/i });
      await user.click(inspectBtns[0]!);
      await waitFor(() => {
        expect(screen.getByText('Plugin Details: traefik-proxy')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /hot reload/i })).not.toBeInTheDocument();
    });

    it('opens inspect modal, displays architecture & telemetry, and supports hot-reload', async () => {
      const user = userEvent.setup();
      mockOf(api.plugins.inspect).mockResolvedValue({
        id: 'traefik-proxy',
        name: 'Traefik Dynamic Proxy',
        version: '2.11.0',
        description: 'Reverse proxy and automatic TLS ingress provider',
        author: 'NineDeploy Team',
        isOfficial: true,
        enabled: true,
        status: 'active',
        dependencies: [],
        hooks: ['service.created', 'deploy.completed'],
        services: ['proxy-worker'],
        menus: [{ id: 'traefik-menu', label: 'Traefik Hub', route: '/traefik', slot: 'sidebar:main' }],
        configSchema: [
          { key: 'acme_email', type: 'string', label: 'ACME Email' },
          { key: 'default_flag' },
        ],
        error: null,
        runtimeStats: { eventsHandled: 42, uptimeSeconds: 3600 },
      });
      mockOf(api.plugins.reload).mockResolvedValue({ ok: true, id: 'traefik-proxy', status: 'active' });

      renderWithProviders(<PluginsSection />);
      await waitFor(() => {
        expect(screen.getByText('Traefik Dynamic Proxy')).toBeInTheDocument();
      });

      // Click Inspect
      const inspectBtns = screen.getAllByRole('button', { name: /inspect/i });
      await user.click(inspectBtns[0]!);

      await waitFor(() => {
        expect(screen.getByText('Plugin Details: traefik-proxy')).toBeInTheDocument();
        expect(screen.getByText(/NineDeploy Team/)).toBeInTheDocument();
        expect(screen.getByText('proxy-worker')).toBeInTheDocument();
        expect(screen.getByText('Traefik Hub')).toBeInTheDocument();
      });

      // Click Hot Reload
      await user.click(screen.getByRole('button', { name: /hot reload/i }));
      expect(mockOf(api.plugins.reload)).toHaveBeenCalledWith('traefik-proxy');

      // Close modal
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(screen.queryByText('Plugin Details: traefik-proxy')).not.toBeInTheDocument();
      });
    });

    it('displays inspect modal with error and empty architecture fields', async () => {
      const user = userEvent.setup();
      mockOf(api.plugins.inspect).mockResolvedValue({
        id: 'errored-plugin',
        name: 'Broken Plugin',
        version: '0.1.0',
        description: '',
        author: '',
        isOfficial: false,
        enabled: false,
        status: 'errored',
        dependencies: [],
        hooks: [],
        services: [],
        menus: [],
        configSchema: [],
        error: 'Critical initialization failure',
        runtimeStats: { eventsHandled: 0, uptimeSeconds: 0 },
      });

      renderWithProviders(<PluginsSection />);
      await waitFor(() => {
        expect(screen.getByText('Broken Plugin')).toBeInTheDocument();
      });

      const inspectBtns = screen.getAllByRole('button', { name: /inspect/i });
      await user.click(inspectBtns[2]!);

      await waitFor(() => {
        expect(screen.getByText('Plugin Details: errored-plugin')).toBeInTheDocument();
        expect(screen.getByText('Critical initialization failure')).toBeInTheDocument();
        expect(screen.getByText('No custom settings registered.')).toBeInTheDocument();
        expect(screen.getByText('No navigation items registered.')).toBeInTheDocument();
      });
    });
  });

  describe('ConfigCenterSection Edge Cases', () => {
    it('cancels edit and create modals', async () => {
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
      });

      // Open and cancel edit modal
      let editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[0]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.site_name')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByText('Edit Config: system.site_name')).not.toBeInTheDocument();
      });

      // Open and close edit modal via X button
      editBtns = screen.getAllByTitle('Edit Value');
      fireEvent.click(editBtns[0]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: system.site_name')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByLabelText('Close dialog')[0]!);
      await waitFor(() => {
        expect(screen.queryByText('Edit Config: system.site_name')).not.toBeInTheDocument();
      });

      // Open and cancel new setting modal
      fireEvent.click(screen.getByText('New Setting'));
      await waitFor(() => {
        expect(screen.getByText('Create Configuration Key')).toBeInTheDocument();
      });
      fireEvent.change(screen.getByPlaceholderText('general, security, network...'), { target: { value: 'custom_cat' } });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByText('Create Configuration Key')).not.toBeInTheDocument();
      });

      // Open and close new setting modal via X button
      fireEvent.click(screen.getByText('New Setting'));
      await waitFor(() => {
        expect(screen.getByText('Create Configuration Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByLabelText('Close dialog')[0]!);
      await waitFor(() => {
        expect(screen.queryByText('Create Configuration Key')).not.toBeInTheDocument();
      });
    });

    it('handles reject confirmation on delete', async () => {
      const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(false);
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
      });

      const deleteBtns = screen.getAllByTitle('Delete');
      fireEvent.click(deleteBtns[0]!);

      expect(confirmMock).toHaveBeenCalled();
      expect(mockOf(api.config.delete)).not.toHaveBeenCalled();
      confirmMock.mockRestore();
    });

    it('edits a secret while secrets are revealed, and creates setting with empty description', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigCenterSection />);

      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
      });

      // Reveal secrets
      const revealBtn = screen.getByRole('button', { name: /reveal secrets/i });
      await user.click(revealBtn);
      await waitFor(() => {
        expect(mockOf(api.config.list)).toHaveBeenCalledWith({ reveal: true });
      });

      // Edit secret item (plugin:smtp:password) at index 5
      let editBtns = await screen.findAllByTitle('Edit Value');
      fireEvent.click(editBtns[5]!);
      await waitFor(() => {
        expect(screen.getByText('Edit Config: plugin:smtp:password')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      // Create setting with empty description
      fireEvent.click(screen.getByText('New Setting'));
      await waitFor(() => {
        expect(screen.getByText('Create Configuration Key')).toBeInTheDocument();
      });
      fireEvent.change(screen.getByPlaceholderText('e.g. system.custom_timeout or plugin:my-plugin:api_key'), { target: { value: 'nodesc.key' } });
      fireEvent.change(screen.getByPlaceholderText('Setting value'), { target: { value: '123' } });
      fireEvent.click(screen.getByRole('button', { name: /create setting/i }));

      await waitFor(() => {
        expect(mockOf(api.config.set)).toHaveBeenCalledWith('nodesc.key', expect.objectContaining({
          description: undefined,
          value: '123',
        }));
      });
    });

    it('renders for member without reveal or edit buttons', async () => {
      mockOf(useAuth).mockReturnValue({
        user: { id: 2, email: 'member@test.com', name: 'Member', role: 'member' },
        loading: false,
        login: vi.fn(),
        setup: vi.fn(),
        logout: vi.fn(),
        loginWithPasskey: vi.fn(),
      });

      renderWithProviders(<ConfigCenterSection />);
      await waitFor(() => {
        expect(screen.getByText('system.site_name')).toBeInTheDocument();
      });

      expect(screen.queryByText('New Setting')).not.toBeInTheDocument();
      expect(screen.queryByText(/reveal secrets/i)).not.toBeInTheDocument();
      expect(screen.queryByTitle('Edit Value')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    });
  });

  describe('Settings Tabs Integration', () => {
    it('navigates to Config Center and Plugins tabs from Settings main page', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Config Center')).toBeInTheDocument();
        expect(screen.getByText('Plugins')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Config Center'));
      await waitFor(() => {
        expect(screen.getByText('Configuration Center')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Plugins'));
      await waitFor(() => {
        expect(screen.getByText('Plugin Ecosystem')).toBeInTheDocument();
      });
    });
  });
});
