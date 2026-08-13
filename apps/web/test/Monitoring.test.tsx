import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Monitoring } from '../src/routes/Monitoring.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const host = {
  cpuCores: 8,
  load1: 1.5,
  memUsedBytes: 4 * 1024 ** 3,
  memTotalBytes: 16 * 1024 ** 3,
  diskUsedBytes: 100 * 1024 ** 3,
  diskTotalBytes: 200 * 1024 ** 3,
};

const snapshot = {
  host,
  containers: [
    { kind: 'service', refId: 1, refName: 'api', name: 'nd-api', engine: null, cpuPct: 12.5, memMb: 256, memLimitMb: 512 },
    { kind: 'database', refId: 2, refName: 'db', name: 'nd-db', engine: 'postgres', cpuPct: 0.25, memMb: 64, memLimitMb: 0 },
  ],
};

describe('Monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders host overview with percentages', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue(snapshot as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('8 cores');
    expect(screen.getByText(/load 1\.50/)).toBeInTheDocument();
    // mem 4/16 GB = 25%
    expect(screen.getByText('25%')).toBeInTheDocument();
    // disk 100/200 = 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('4.0 GB / 16.0 GB')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // workloads
  });

  it('shows skeleton while loading and empty state when no containers', async () => {
    const never = new Promise(() => {});
    mockOf(api.stats.snapshot).mockReturnValueOnce(never as never);
    const { unmount } = renderWithProviders(<Monitoring />);
    expect(document.querySelectorAll('.animate-pulse').length).toBe(6);
    unmount();

    mockOf(api.stats.snapshot).mockResolvedValue({ host: null, containers: [] } as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('No running workloads yet.');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // cpu/mem/disk values
  });

  it('formats sub-gigabyte and zero byte host values', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue({
      host: {
        cpuCores: 2,
        load1: 0.5,
        memUsedBytes: 512 * 1024 * 1024, // < 1GB -> MB
        memTotalBytes: 1024 * 1024 * 1024,
        diskUsedBytes: 0, // falsy -> '—'
        diskTotalBytes: 200 * 1024 ** 3,
      },
      containers: [],
    } as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('512 MB / 1.0 GB');
    // diskUsedBytes is 0 (falsy) → fmtBytes renders '—' as the used portion.
    expect(screen.getByText(/—\s*\/\s*/)).toBeInTheDocument();
  });

  it('renders container cards with cpu/mem and limits form for services', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue(snapshot as never);
    mockOf(api.stats.metrics).mockResolvedValue({ points: [{ value: 50 }, { value: 80 }] } as never);
    mockOf(api.limits.setService).mockResolvedValue({ cpuShares: 512, memLimitMb: 1024 } as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('api');
    expect(screen.getByText((_, el) => el?.textContent === '12.50%')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent?.startsWith('256MB') === true)).toBeInTheDocument();
    expect(screen.getByText('/ 512')).toBeInTheDocument();
    // database card
    expect(screen.getByText('db')).toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
    // service sparkline renders an svg
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0);
    // limits form for service
    const cpuInput = screen.getAllByPlaceholderText('cpu shares')[0]!;
    const memInput = screen.getAllByPlaceholderText('mem MB')[0]!;
    await userEvent.type(cpuInput, '512');
    await userEvent.type(memInput, '1024');
    fireEvent.submit(cpuInput.closest('form')!);
    await waitFor(() => expect(api.limits.setService).toHaveBeenCalledWith(1, { cpuShares: 512, memLimitMb: 1024 }));
  });

  it('submits zero limits when the fields are empty', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue(snapshot as never);
    mockOf(api.limits.setService).mockResolvedValue({ cpuShares: 0, memLimitMb: 0 } as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('api');
    const cpuInput = screen.getAllByPlaceholderText('cpu shares')[0]!;
    fireEvent.submit(cpuInput.closest('form')!);
    await waitFor(() => expect(api.limits.setService).toHaveBeenCalledWith(1, { cpuShares: 0, memLimitMb: 0 }));
  });

  it('shows the pending state while limits are being saved', async () => {
    mockOf(api.stats.snapshot).mockResolvedValue(snapshot as never);
    mockOf(api.limits.setService).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('api');
    const cpuInput = screen.getAllByPlaceholderText('cpu shares')[0]!;
    await userEvent.type(cpuInput, '256');
    fireEvent.submit(cpuInput.closest('form')!);
    expect(await screen.findByText('…')).toBeInTheDocument();
  });

  it('saves database limits and covers bar tones', async () => {
    const highHost = {
      ...host,
      memUsedBytes: 15 * 1024 ** 3, // 93% -> rose
      diskUsedBytes: 140 * 1024 ** 3, // 70% -> amber
    };
    mockOf(api.stats.snapshot).mockResolvedValue({ host: highHost, containers: [snapshot.containers[1]] } as never);
    mockOf(api.limits.setDatabase).mockResolvedValue({ cpuShares: 128, memLimitMb: 128 } as never);
    renderWithProviders(<Monitoring />);
    await screen.findByText('db');
    const memInput = screen.getAllByPlaceholderText('mem MB')[0]!;
    await userEvent.type(memInput, '128');
    fireEvent.submit(memInput.closest('form')!);
    await waitFor(() => expect(api.limits.setDatabase).toHaveBeenCalledWith(2, { cpuShares: 0, memLimitMb: 128 }));
  });
});
