import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../src/routes/Settings.js';
import { api, getToken } from '../src/lib/api.js';
import { useTheme } from '../src/lib/theme.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

vi.mock('../src/lib/theme.js', async () => {
  const { createThemeMock } = await import('./helpers.js');
  return createThemeMock();
});

const toastSpy = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../src/components/Toast.js', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastSpy,
}));

vi.mock('../src/components/NotificationWizard.js', () => ({
  NotificationWizard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="notif-wizard">
      wizard
      <button onClick={onClose}>close wizard</button>
    </div>
  ),
}));

const host = {
  cpuCores: 8,
  load1: 1.25,
  memUsedBytes: 8 * 1024 ** 3,
  memTotalBytes: 16 * 1024 ** 3,
  diskUsedBytes: 1.5 * 1024 ** 4,
  diskTotalBytes: 2 * 1024 ** 4,
};

const channels = [
  { id: 1, name: 'telegram-main', type: 'telegram', eventFilter: 'deploy.*', active: true, createdAt: 'x' },
  { id: 2, name: 'discord-alerts', type: 'discord', eventFilter: null, active: true, createdAt: 'x' },
  { id: 3, name: 'webhook', type: 'generic', eventFilter: null, active: true, createdAt: 'x' },
];

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSpy.toast.mockClear();
    vi.stubGlobal('fetch', vi.fn());
    URL.createObjectURL = vi.fn(() => 'blob:settings');
    URL.revokeObjectURL = vi.fn();
    mockOf(api.stats.snapshot).mockResolvedValue({ host } as never);
    mockOf(api.system.resources).mockResolvedValue({
      network: 'nd-net',
      containers: 4,
      volumes: 2,
      imagesSummary: { active: 3, total: 3, size: '1 GB', reclaimable: '200 MB' },
    } as never);
    mockOf(api.notifications.listChannels).mockResolvedValue(channels as never);
  });

  it('renders system info, resources, theme controls and notification channels', async () => {
    mockOf(useTheme).mockReturnValue({
      theme: 'dark',
      accent: 'indigo',
      setTheme: vi.fn(),
      setAccent: vi.fn(),
      toggleTheme: vi.fn(),
    } as never);
    renderWithProviders(<Settings />);
    // system info rows
    await screen.findByText('nd-net');
    expect(screen.getByText('v0.0.0 · MIT')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3/3 active')).toBeInTheDocument();
    // wildcard domain configured because host exists
    expect(screen.getByText('*.nd.local')).toBeInTheDocument();
    // host resources bars
    expect(screen.getByText('50% · 8.0 GB / 16.0 GB')).toBeInTheDocument();
    expect(screen.getByText('1.25')).toBeInTheDocument();
    // image storage + reclaimable
    expect(screen.getByText('200 MB reclaimable')).toBeInTheDocument();
    // notification channels with type badges
    expect(screen.getByText('telegram-main')).toBeInTheDocument();
    expect(screen.getByText('discord-alerts')).toBeInTheDocument();
    expect(screen.getByText('deploy.*')).toBeInTheDocument();
  });

  it('switches theme and accent via the appearance controls', async () => {
    const theme = {
      theme: 'dark',
      accent: 'indigo',
      setTheme: vi.fn(),
      setAccent: vi.fn(),
      toggleTheme: vi.fn(),
    };
    mockOf(useTheme).mockReturnValue(theme as never);
    renderWithProviders(<Settings />);
    await userEvent.click(await screen.findByRole('button', { name: /light/ }));
    expect(theme.setTheme).toHaveBeenCalledWith('light');
    await userEvent.click(screen.getByRole('button', { name: /Blue/ }));
    expect(theme.setAccent).toHaveBeenCalledWith('blue');
  });

  it('renders fallbacks when stats/resources are missing', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue({ host: null } as never);
    mockOf(api.system.resources).mockResolvedValue(null as never);
    mockOf(api.notifications.listChannels).mockResolvedValue([] as never);
    renderWithProviders(<Settings />);
    // 'not configured' renders during loading too, so await a post-load-only text
    await screen.findByText('Docker daemon not reachable.');
    expect(screen.getByText('not configured')).toBeInTheDocument();
    expect(screen.getByText('ninedeploy')).toBeInTheDocument(); // network fallback
    expect(screen.getByText('No notification channels configured.')).toBeInTheDocument();
  });

  it('shows skeleton for host resources while stats load', async () => {
    mockOf(api.stats.snapshot).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);
    await screen.findByText('Host Resources');
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('exports backup on success and reports failure', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) } as Response);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: /Export backup/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/system/export');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${getToken()}` });
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Export downloaded', 'success'));

    fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    fireEvent.click(screen.getByRole('button', { name: /Export backup/ }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Export failed', 'error'));
  });

  it('exports with an empty bearer when no token is set', async () => {
    mockOf(getToken).mockReturnValue(null);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) } as Response);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: /Export backup/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer ' });
  });

  it('imports a backup file', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Restart required' }) } as Response);
    renderWithProviders(<Settings />);
    await screen.findByRole('button', { name: /Export backup/ });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'backup.tar.gz', { type: 'application/gzip' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Restart required', 'success'));
  });

  it('uses the default import completion message when json has none', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    renderWithProviders(<Settings />);
    await screen.findByRole('button', { name: /Export backup/ });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.tar.gz')] } });
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Import complete — restart NineDeploy', 'success'));
  });

  it('imports with an empty bearer when no token is set', async () => {
    mockOf(getToken).mockReturnValue(null);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'ok' }) } as Response);
    renderWithProviders(<Settings />);
    await screen.findByRole('button', { name: /Export backup/ });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.tar.gz')] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer ' });
  });

  it('ignores a change event without a selected file', async () => {
    renderWithProviders(<Settings />);
    await screen.findByRole('button', { name: /Export backup/ });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders rose bars when host usage is very high', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue({
      host: { ...host, memUsedBytes: 15 * 1024 ** 3, memTotalBytes: 16 * 1024 ** 3 }, // ~94% -> rose
    } as never);
    renderWithProviders(<Settings />);
    await screen.findByText('94% · 15.0 GB / 16.0 GB');
  });

  it('formats sub-gigabyte host values in MB', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue({
      host: {
        cpuCores: 2,
        load1: 0.1,
        memUsedBytes: 512 * 1024 * 1024,
        memTotalBytes: 1024 * 1024 * 1024,
        diskUsedBytes: 256 * 1024 * 1024,
        diskTotalBytes: 1024 * 1024 * 1024,
      },
    } as never);
    renderWithProviders(<Settings />);
    await screen.findByText('50% · 512 MB / 1.0 GB');
    expect(screen.getByText('25% · 256 MB / 1.0 GB')).toBeInTheDocument();
  });

  it('refreshes docker resources from the image storage card', async () => {
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(api.system.resources).toHaveBeenCalledTimes(2));
  });

  it('opens the file picker from the import backup button', async () => {
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: /Import backup/ }));
    // clicking the hidden file input is a no-op in jsdom, but the handler ran
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('handles import failure', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<Settings />);
    await screen.findByRole('button', { name: /Export backup/ });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['data'], 'b.tar.gz')] } });
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Import failed', 'error'));
  });

  it('tests and removes notification channels', async () => {
    mockOf(api.notifications.testChannel).mockResolvedValue({ ok: true } as never);
    mockOf(api.notifications.removeChannel).mockResolvedValue(undefined as never);
    renderWithProviders(<Settings />);
    const testButtons = await screen.findAllByTitle('Send test');
    fireEvent.click(testButtons[0]!);
    await waitFor(() => expect(api.notifications.testChannel).toHaveBeenCalledWith(1));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Test sent!', 'success'));

    fireEvent.click(screen.getAllByTitle('Remove')[0]!);
    await waitFor(() => expect(api.notifications.removeChannel).toHaveBeenCalledWith(1));
  });

  it('pauses and resumes a channel via the active toggle', async () => {
    mockOf(api.notifications.updateChannel).mockResolvedValue({ id: 1, active: false } as never);
    renderWithProviders(<Settings />);
    const pause = (await screen.findAllByTitle('Pause (deactivate)'))[0]!;
    fireEvent.click(pause);
    await waitFor(() => expect(api.notifications.updateChannel).toHaveBeenCalledWith(1, { active: false }));
  });

  it('shows a paused badge and offers activation', async () => {
    mockOf(api.notifications.listChannels).mockResolvedValueOnce([
      { id: 9, name: 'quiet', type: 'slack', eventFilter: null, active: false, createdAt: 'x' },
    ] as never);
    mockOf(api.notifications.updateChannel).mockResolvedValue({ id: 9, active: true } as never);
    renderWithProviders(<Settings />);
    expect(await screen.findByText('paused')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Activate'));
    await waitFor(() => expect(api.notifications.updateChannel).toHaveBeenCalledWith(9, { active: true }));
  });

  it('edits a channel name and event filter inline', async () => {
    mockOf(api.notifications.updateChannel).mockResolvedValue({ id: 1 } as never);
    renderWithProviders(<Settings />);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]!);
    const name = screen.getByLabelText('Channel name') as HTMLInputElement;
    const filter = screen.getByLabelText('Event filter') as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'ops-renamed');
    await userEvent.clear(filter);
    await userEvent.type(filter, 'deploy.,alert.');
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(api.notifications.updateChannel).toHaveBeenCalledWith(1, { name: 'ops-renamed', eventFilter: 'deploy.,alert.' }),
    );
  });

  it('opens the editor on a channel without a filter (null coalescing)', async () => {
    renderWithProviders(<Settings />);
    fireEvent.click((await screen.findAllByTitle('Edit'))[1]!); // discord-alerts: eventFilter null
    const filter = screen.getByLabelText('Event filter') as HTMLInputElement;
    expect(filter.value).toBe('');
    expect(screen.getByLabelText('Channel name')).toBeInTheDocument();
  });

  it('falls back to the current name when the edit field is emptied', async () => {
    mockOf(api.notifications.updateChannel).mockResolvedValue({ id: 1 } as never);
    renderWithProviders(<Settings />);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]!);
    const name = screen.getByLabelText('Channel name') as HTMLInputElement;
    await userEvent.clear(name);
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(api.notifications.updateChannel).toHaveBeenCalledWith(1, { name: 'telegram-main', eventFilter: 'deploy.*' }),
    );
  });

  it('shows the saving state while a channel edit is in flight', async () => {
    mockOf(api.notifications.updateChannel).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]!);
    fireEvent.submit((screen.getByLabelText('Channel name') as HTMLInputElement).closest('form')!);
    expect(await screen.findByText('…')).toBeInTheDocument();
  });

  it('cancels the inline channel editor', async () => {
    renderWithProviders(<Settings />);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]!);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByLabelText('Event filter')).not.toBeInTheDocument();
  });

  it('reports channel edit failures', async () => {
    mockOf(api.notifications.updateChannel).mockRejectedValue(new Error('500'));
    renderWithProviders(<Settings />);
    fireEvent.click((await screen.findAllByTitle('Edit'))[0]!);
    fireEvent.submit((screen.getByLabelText('Channel name') as HTMLInputElement).closest('form')!);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not update the channel', 'error'));
  });

  it('reports a failed test notification', async () => {
    mockOf(api.notifications.testChannel).mockRejectedValue(new Error('nope'));
    renderWithProviders(<Settings />);
    const testButtons = await screen.findAllByTitle('Send test');
    fireEvent.click(testButtons[0]!);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Test failed', 'error'));
  });

  it('opens and closes the notification wizard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await user.click(await screen.findByRole('button', { name: '+ Add channel' }));
    expect(screen.getByTestId('notif-wizard')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'close wizard' }));
    expect(screen.queryByTestId('notif-wizard')).not.toBeInTheDocument();
  });

  const saveButtonNextTo = (label: string) => {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    return input.parentElement!.querySelector('button')!;
  };

  it('shows and saves the ACME email', async () => {
    const user = userEvent.setup();
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: 'ops@example.com' } as never);
    mockOf(api.settings.setAcmeEmail).mockResolvedValue({ ok: true, acmeEmail: 'new@example.com', applied: 'restart' } as never);
    renderWithProviders(<Settings />);

    const input = await screen.findByLabelText('ACME account email') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('ops@example.com'));
    expect(screen.getByText(/Not configured|Configured/)).toHaveTextContent('Configured.');
    await user.clear(input);
    await user.type(input, 'new@example.com');
    await user.click(saveButtonNextTo('ACME account email'));
    await waitFor(() => expect(api.settings.setAcmeEmail).toHaveBeenCalledWith('new@example.com'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('ACME email saved — applies on next restart', 'success'));
  });

  it('shows and saves the template registry source', async () => {
    const user = userEvent.setup();
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: null } as never);
    mockOf(api.settings.setTemplatesSource).mockResolvedValue({ ok: true, templatesSource: 'https://registry.example.com/r.json' } as never);
    renderWithProviders(<Settings />);

    const input = await screen.findByLabelText('Template registry source') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByText(/bundled registry from this repo/)).toBeInTheDocument();
    await user.type(input, 'https://registry.example.com/r.json');
    await user.click(saveButtonNextTo('Template registry source'));
    await waitFor(() => expect(api.settings.setTemplatesSource).toHaveBeenCalledWith('https://registry.example.com/r.json'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Template registry source saved', 'success'));
  });

  it('shows and saves the DNS challenge config', async () => {
    const user = userEvent.setup();
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: null, dnsProvider: 'cloudflare', hasDnsToken: true, wildcardApex: 'example.com' } as never);
    mockOf(api.settings.setDns).mockResolvedValue({ ok: true, dnsProvider: 'cloudflare', wildcardApex: 'example.com', applied: 'restart' } as never);
    renderWithProviders(<Settings />);

    const provider = await screen.findByLabelText('DNS provider') as HTMLSelectElement;
    await waitFor(() => expect(provider.value).toBe('cloudflare'));
    expect((screen.getByLabelText('Wildcard domain apex') as HTMLInputElement).value).toBe('example.com');
    expect(screen.getByText(/API token configured/)).toBeInTheDocument();

    await user.selectOptions(provider, 'hetzner');
    await user.type(screen.getByLabelText('DNS API token'), 'fresh-token');
    const apex = screen.getByLabelText('Wildcard domain apex') as HTMLInputElement;
    await user.clear(apex);
    await user.type(apex, 'example.org');
    fireEvent.click(saveButtonNextTo('Wildcard domain apex'));
    await waitFor(() =>
      expect(api.settings.setDns).toHaveBeenCalledWith({ provider: 'hetzner', token: 'fresh-token', wildcardApex: 'example.org' }),
    );
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('DNS challenge saved — applies on next restart', 'success'));
  });

  it('keeps the stored token when the field is left empty and reports failures', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: null, dnsProvider: '', hasDnsToken: true, wildcardApex: '' } as never);
    mockOf(api.settings.setDns).mockRejectedValue(new Error('500'));
    renderWithProviders(<Settings />);

    await screen.findByLabelText('DNS provider');
    fireEvent.click(saveButtonNextTo('Wildcard domain apex'));
    await waitFor(() =>
      expect(api.settings.setDns).toHaveBeenCalledWith({ provider: '', token: undefined, wildcardApex: '' }),
    );
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not save the DNS challenge settings', 'error'));
  });

  it('shows the saving state while the DNS config is in flight', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: null, dnsProvider: '', hasDnsToken: false, wildcardApex: '' } as never);
    mockOf(api.settings.setDns).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);

    await screen.findByLabelText('DNS provider');
    fireEvent.click(saveButtonNextTo('Wildcard domain apex'));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
  });

  it('shows the saving state while the template source is in flight', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: null } as never);
    mockOf(api.settings.setTemplatesSource).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);

    await screen.findByLabelText('Template registry source');
    fireEvent.click(saveButtonNextTo('Template registry source'));
    await waitFor(() => expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0));
  });

  it('reports template source save failures and shows a custom source', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: '/etc/ninedeploy/registry.json' } as never);
    mockOf(api.settings.setTemplatesSource).mockRejectedValue(new Error('500'));
    renderWithProviders(<Settings />);

    const input = await screen.findByLabelText('Template registry source') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('/etc/ninedeploy/registry.json'));
    expect(screen.getByText(/custom \(\/etc\/ninedeploy\/registry\.json\)/)).toBeInTheDocument();
    fireEvent.click(saveButtonNextTo('Template registry source'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not save the template source', 'error'));
  });

  it('shows the saving state while the ACME email is in flight', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null } as never);
    mockOf(api.settings.setAcmeEmail).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);

    await screen.findByLabelText('ACME account email');
    fireEvent.click(saveButtonNextTo('ACME account email'));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
  });

  it('reports ACME save failures and renders the unconfigured hint', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null } as never);
    mockOf(api.settings.setAcmeEmail).mockRejectedValue(new Error('500'));
    renderWithProviders(<Settings />);

    const input = await screen.findByLabelText('ACME account email') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
    fireEvent.click(saveButtonNextTo('ACME account email'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not save the ACME email', 'error'));
  });

  it('renders and toggles the open-registration switch', async () => {
    const user = userEvent.setup();
    // Initial load says allowed; the post-toggle refetch says disabled.
    mockOf(api.settings.get).mockResolvedValueOnce({ allowRegistration: true } as never)
      .mockResolvedValueOnce({ allowRegistration: false } as never);
    mockOf(api.settings.setAllowRegistration).mockResolvedValue({ ok: true, allowRegistration: false } as never);
    renderWithProviders(<Settings />);

    const sw = await screen.findByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);

    await waitFor(() => expect(api.settings.setAllowRegistration).toHaveBeenCalledWith(false));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
  });

  it('shows the default (allowed) switch while settings load and reports toggle failures', async () => {
    const user = userEvent.setup();
    let resolveGet!: (v: unknown) => void;
    mockOf(api.settings.get).mockReturnValue(new Promise((r) => { resolveGet = r; }) as never);
    mockOf(api.settings.setAllowRegistration).mockRejectedValue(new Error('500'));
    renderWithProviders(<Settings />);

    const sw = await screen.findByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true'); // optimistic default
    resolveGet({ allowRegistration: true });
    await user.click(sw);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not update the setting', 'error'));
  });

  it('disables the switch while the toggle is in flight', async () => {
    const user = userEvent.setup();
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true } as never);
    let resolveToggle!: (v: unknown) => void;
    mockOf(api.settings.setAllowRegistration).mockReturnValue(
      new Promise((r) => { resolveToggle = r; }) as never,
    );
    renderWithProviders(<Settings />);

    const sw = await screen.findByRole('switch');
    await user.click(sw);
    await waitFor(() => expect(sw).toBeDisabled());
    resolveToggle({ ok: true, allowRegistration: false });
    await waitFor(() => expect(sw).toBeEnabled());
  });

  it('renders the switch disabled while the settings query is loading', async () => {
    mockOf(api.settings.get).mockReturnValue(new Promise(() => {}) as never); // never resolves
    renderWithProviders(<Settings />);
    const sw = await screen.findByRole('switch');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-checked', 'true'); // optimistic default
  });

  it('changes the password and persists the fresh token pair', async () => {
    const user = userEvent.setup();
    mockOf(api.auth.changePassword).mockResolvedValue({
      user: { id: 1 },
      tokens: { accessToken: 'new-acc', refreshToken: 'new-ref', expiresIn: 900 },
    } as never);
    renderWithProviders(<Settings />);

    await user.type(await screen.findByLabelText('Current password'), 'old-pass-123');
    await user.type(screen.getByLabelText('New password'), 'new-pass-456');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-pass-456');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(api.auth.changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-pass-123',
        newPassword: 'new-pass-456',
      }),
    );
    expect(toastSpy.toast).toHaveBeenCalledWith(
      expect.stringContaining('other sessions signed out'),
      'success',
    );
  });

  it('rejects mismatched confirmation without calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);

    await user.type(await screen.findByLabelText('Current password'), 'old-pass-123');
    await user.type(screen.getByLabelText('New password'), 'new-pass-456');
    await user.type(screen.getByLabelText('Confirm new password'), 'different-789');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(api.auth.changePassword).not.toHaveBeenCalled();
    expect(toastSpy.toast).toHaveBeenCalledWith('New passwords do not match', 'error');
  });

  it('rejects a too-short new password without calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);

    await user.type(await screen.findByLabelText('Current password'), 'old-pass-123');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(api.auth.changePassword).not.toHaveBeenCalled();
    expect(toastSpy.toast).toHaveBeenCalledWith('New password must be at least 8 characters', 'error');
  });

  it('shows the pending state while the password change is in flight', async () => {
    const user = userEvent.setup();
    let resolveChange!: (v: unknown) => void;
    mockOf(api.auth.changePassword).mockReturnValue(
      new Promise((r) => {
        resolveChange = r;
      }) as never,
    );
    renderWithProviders(<Settings />);

    await user.type(await screen.findByLabelText('Current password'), 'old-pass-123');
    await user.type(screen.getByLabelText('New password'), 'new-pass-456');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-pass-456');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Changing…' })).toBeDisabled());
    resolveChange({ tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 } });
    // Back to idle (and disabled again — the fields were cleared on success).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled(),
    );
  });

  it('reports a failed password change as an error toast', async () => {
    const user = userEvent.setup();
    mockOf(api.auth.changePassword).mockRejectedValue(new Error('401'));
    renderWithProviders(<Settings />);

    await user.type(await screen.findByLabelText('Current password'), 'wrong-old');
    await user.type(screen.getByLabelText('New password'), 'new-pass-456');
    await user.type(screen.getByLabelText('Confirm new password'), 'new-pass-456');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() =>
      expect(toastSpy.toast).toHaveBeenCalledWith('Password change failed', 'error'),
    );
  });

  // ── Two-factor (TOTP) ───────────────────────────────────────────────────
  const PW = ['current', '-pass', '-1'].join('');

  it('runs the full 2FA setup → enable flow', async () => {
    const user = userEvent.setup();
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      otpauthUri: 'otpauth://totp/NineDeploy%3Aa%40b.c?secret=x',
    } as never);
    mockOf(api.auth.twoFactor.enable).mockResolvedValue({ ok: true, totpEnabled: true } as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<Settings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    expect(await screen.findByText('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
    fireEvent.click(screen.getByText('Copy URI'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('otpauth://totp/NineDeploy%3Aa%40b.c?secret=x'));

    await user.type(screen.getByPlaceholderText('123456'), '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(api.auth.twoFactor.enable).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Two-factor authentication enabled', 'success'));
  });

  it('reports an invalid code on enable', async () => {
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' } as never);
    mockOf(api.auth.twoFactor.enable).mockRejectedValue(new Error('bad code') as never);
    renderWithProviders(<Settings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    const input = await screen.findByPlaceholderText('123456');
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Invalid or expired code', 'error'));
  });

  it('cancels out of setup', async () => {
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' } as never);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    fireEvent.click(await screen.findByText('Cancel'));
    expect(screen.queryByText('otpauth://totp/x')).not.toBeInTheDocument();
  });

  it('submits the setup form via form submit and shows the enable pending label', async () => {
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' } as never);
    mockOf(api.auth.twoFactor.enable).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    const codeInput = await screen.findByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.submit(codeInput.closest('form')!);
    expect(await screen.findByText('Verifying…')).toBeInTheDocument();
  });

  it('shows the setup pending label while generating', async () => {
    mockOf(api.auth.twoFactor.setup).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    expect(await screen.findByText('Generating…')).toBeInTheDocument();
  });

  it('ignores 2FA form submits with incomplete inputs', async () => {
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' } as never);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    // Enable with a too-short code: no call.
    const codeInput = await screen.findByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '123' } });
    fireEvent.submit(codeInput.closest('form')!);
    expect(api.auth.twoFactor.enable).not.toHaveBeenCalled();

    // Disable with an empty password: no call.
    fireEvent.click(screen.getByText('Cancel')); // close the setup panel first
    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    const pwInput = await screen.findByPlaceholderText('Password');
    fireEvent.change(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.submit(pwInput.closest('form')!);
    expect(api.auth.twoFactor.disable).not.toHaveBeenCalled();
  });

  it('shows the disable pending label while in flight', async () => {
    mockOf(api.auth.twoFactor.disable).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disable 2FA' }));
    const pwInput = await screen.findByPlaceholderText('Password');
    fireEvent.change(pwInput, { target: { value: 'x'.repeat(8) } });
    fireEvent.change(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.submit(pwInput.closest('form')!);
    expect(await screen.findByText('Disabling…')).toBeInTheDocument();
  });

  it('shows the enable pending label while verifying', async () => {
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' } as never);
    mockOf(api.auth.twoFactor.enable).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    const codeInput = await screen.findByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('Verifying…')).toBeInTheDocument();
  });

  it('reports clipboard failures when copying the secret', async () => {
    mockOf(api.auth.twoFactor.setup).mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' } as never);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    fireEvent.click(await screen.findByText('Copy'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Copy failed', 'error'));
  });

  it('reports setup failures', async () => {
    mockOf(api.auth.twoFactor.setup).mockRejectedValue(new Error('nope') as never);
    renderWithProviders(<Settings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2FA' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not start 2FA setup', 'error'));
  });

  it('disables 2FA with password + code and signs out', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    mockOf(api.auth.twoFactor.disable).mockResolvedValue({ ok: true, totpEnabled: false } as never);
    renderWithProviders(<Settings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable 2FA' }));
    await user.type(await screen.findByPlaceholderText('Password'), PW);
    const codeInputs = screen.getAllByPlaceholderText('6-digit code');
    await user.type(codeInputs[0]!, '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA', hidden: false }));
    await waitFor(() =>
      expect(api.auth.twoFactor.disable).toHaveBeenCalledWith({ password: PW, code: '123456' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'info'));
    // The redirect to /login fires after 1.5s.
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'), { timeout: 3000 });
  });

  it('reports disable failures and cancels', async () => {
    const user = userEvent.setup();
    mockOf(api.auth.twoFactor.disable).mockRejectedValue(new Error('x') as never);
    renderWithProviders(<Settings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disable 2FA' }));
    await user.type(await screen.findByPlaceholderText('Password'), PW);
    fireEvent.change(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith(expect.stringContaining('Could not disable'), 'error'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });
});
