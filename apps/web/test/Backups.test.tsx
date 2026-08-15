import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Backups } from '../src/routes/Backups.js';
import { api, getToken } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const backups = [
  { id: 1, databaseId: 10, databaseName: 'postgres-main', status: 'running', sizeBytes: 512 * 1024, createdAt: '2026-01-01T00:00:00Z' },
  { id: 2, databaseId: null, databaseName: null, status: 'failed', sizeBytes: 2 * 1024 ** 3, createdAt: '2026-01-02T00:00:00Z' },
  { id: 3, databaseId: 12, databaseName: 'cache', status: 'error', sizeBytes: 0, createdAt: '2026-01-03T00:00:00Z' },
  { id: 4, databaseId: 13, databaseName: 'tiny', status: 'idle', sizeBytes: 100, createdAt: '2026-01-04T00:00:00Z' },
  { id: 5, databaseId: 14, databaseName: 'medium', status: 'idle', sizeBytes: 50 * 1024 * 1024, createdAt: '2026-01-05T00:00:00Z' },
];

describe('Backups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn());
    // jsdom has no blob URL support
    URL.createObjectURL = vi.fn(() => 'blob:backup');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows skeleton while loading', () => {
    mockOf(api.backups.list).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Backups />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows empty state when there are no backups', async () => {
    mockOf(api.backups.list).mockResolvedValue([] as never);
    renderWithProviders(<Backups />);
    await screen.findByText('No backups yet');
    expect(screen.getByText(/Use the Backup button/)).toBeInTheDocument();
  });

  it('renders the table with formatted sizes, statuses and dates', async () => {
    mockOf(api.backups.list).mockResolvedValue(backups as never);
    renderWithProviders(<Backups />);
    await screen.findByText('postgres-main');
    expect(screen.getByText('512 KB')).toBeInTheDocument(); // 512*1024 -> 0.5MB <1MB -> KB
    expect(screen.getByText('2.00 GB')).toBeInTheDocument(); // >= 1024 MB
    expect(screen.getByText('50.0 MB')).toBeInTheDocument(); // MB branch
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // 0 bytes + null databaseName
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getAllByText('idle').length).toBeGreaterThan(0); // multiple idle backups
  });

  it('restores a backup after confirmation', async () => {
    mockOf(api.backups.list).mockResolvedValue(backups as never);
    mockOf(api.backups.restore).mockResolvedValue({ ok: true } as never);
    renderWithProviders(<Backups />);
    const buttons = await screen.findAllByTitle('Restore');
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(api.backups.restore).toHaveBeenCalledWith(10, 1));
  });

  it('skips restore when confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockOf(api.backups.list).mockResolvedValue(backups as never);
    renderWithProviders(<Backups />);
    const buttons = await screen.findAllByTitle('Restore');
    fireEvent.click(buttons[0]);
    expect(api.backups.restore).not.toHaveBeenCalled();
  });

  it('deletes a backup', async () => {
    mockOf(api.backups.list).mockResolvedValue(backups as never);
    mockOf(api.backups.remove).mockResolvedValue(undefined as never);
    renderWithProviders(<Backups />);
    const buttons = await screen.findAllByTitle('Delete');
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(api.backups.remove).toHaveBeenCalledWith(1));
  });

  it('downloads a backup on success and does nothing on failure', async () => {
    mockOf(api.backups.list).mockResolvedValue(backups as never);
    const fetchMock = vi.mocked(fetch);
    const okResponse = {
      ok: true,
      blob: async () => new Blob(['data']),
    };
    fetchMock.mockResolvedValueOnce(okResponse as Response);
    renderWithProviders(<Backups />);
    const downloadButtons = await screen.findAllByTitle('Download');
    fireEvent.click(downloadButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/backups/1/download');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${getToken()}` });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    // failure path
    fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    fireEvent.click(downloadButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('downloads without an authorization header when no token is set', async () => {
    mockOf(api.backups.list).mockResolvedValue(backups as never);
    mockOf(getToken).mockReturnValue(null);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) } as Response);
    renderWithProviders(<Backups />);
    const downloadButtons = await screen.findAllByTitle('Download');
    fireEvent.click(downloadButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer ' });
  });

  // ── off-site destinations ───────────────────────────────────────────────
  it('renders destinations with active/paused badges and test/remove actions', async () => {
    mockOf(api.backups.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.list).mockResolvedValue([
      { id: 1, name: 'minio', endpoint: 'https://s3.example.com', region: 'eu', bucket: 'b', prefix: 'nd', active: true, createdAt: 'x' },
      { id: 2, name: 'b2', endpoint: 'https://s3.b2.example.net', region: 'us', bucket: 'b2', prefix: 'nd', active: false, createdAt: 'x' },
    ] as never);
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    renderWithProviders(<Backups />);

    expect(await screen.findByText('minio')).toBeInTheDocument();
    expect(screen.getByText('https://s3.b2.example.net/b2/nd')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle('Test connection')[0]!);
    await waitFor(() => expect(api.backupDestinations.test).toHaveBeenCalledWith(1));
    fireEvent.click(screen.getAllByTitle('Remove destination')[1]!);
    await waitFor(() => expect(api.backupDestinations.remove).toHaveBeenCalledWith(2));
  });

  it('creates a destination from the form', async () => {
    mockOf(api.backups.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.create).mockResolvedValue({ id: 9 } as never);
    renderWithProviders(<Backups />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add destination' }));
    // Inputs appear in form order: name, endpoint, region, bucket, prefix, accessKey + a password field for the secret.
    const values = ['minio-offsite', 'https://s3.example.com', 'eu', 'b', 'nd', 'ak'];
    const inputs = screen.getAllByRole('textbox');
    for (let i = 0; i < values.length && i < inputs.length; i++) {
      fireEvent.change(inputs[i]!, { target: { value: values[i] } });
    }
    const secretInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(secretInput).toBeTruthy();
    fireEvent.change(secretInput!, { target: { value: 'sk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));
    await waitFor(() =>
      expect(api.backupDestinations.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'minio-offsite', endpoint: 'https://s3.example.com', bucket: 'b' })));
  });

  it('keeps the save button disabled until required fields are filled', async () => {
    mockOf(api.backups.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.list).mockResolvedValue([] as never);
    renderWithProviders(<Backups />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add destination' }));
    expect(screen.getByRole('button', { name: 'Save destination' })).toBeDisabled();
    // An incomplete submit does not call the API.
    fireEvent.submit(screen.getAllByRole('textbox')[0]!.closest('form')!);
    expect(api.backupDestinations.create).not.toHaveBeenCalled();
  });

  it('shows the saving state while a destination create is in flight', async () => {
    mockOf(api.backups.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.create).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Backups />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add destination' }));
    const values = ['x', 'https://s3.example.com', 'eu', 'b', 'nd', 'ak'];
    const inputs = screen.getAllByRole('textbox');
    for (let i = 0; i < values.length; i++) fireEvent.change(inputs[i]!, { target: { value: values[i] } });
    const secretInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    fireEvent.change(secretInput!, { target: { value: 'sk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
  });

  it('toggles destination active state and surfaces test failures', async () => {
    mockOf(api.backups.list).mockResolvedValue([] as never);
    mockOf(api.backupDestinations.list).mockResolvedValue([
      { id: 1, name: 'minio', endpoint: 'https://s3.example.com', region: 'eu', bucket: 'b', prefix: 'nd', active: true, createdAt: 'x' },
    ] as never);
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    renderWithProviders(<Backups />);
    fireEvent.click(await screen.findByText('active'));
    await waitFor(() => expect(api.backupDestinations.update).toHaveBeenCalledWith(1, { active: false }));
    // Test failures surface via alert (non-Error rejections use the generic message).
    mockOf(api.backupDestinations.test).mockRejectedValueOnce(new Error('no route') as never);
    fireEvent.click(screen.getByTitle('Test connection'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('no route'));
    mockOf(api.backupDestinations.test).mockRejectedValueOnce('boom' as never);
    fireEvent.click(screen.getByTitle('Test connection'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Test failed'));
  });
});
