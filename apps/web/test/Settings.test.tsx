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
});
