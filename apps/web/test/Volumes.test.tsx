import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Volumes } from '../src/routes/Volumes.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const volumes = [
  { name: 'nd-data', sizeBytes: 512 * 1024 * 1024, owner: { kind: 'database', name: 'db', engine: 'postgres' } },
  { name: 'nd-app', sizeBytes: 2 * 1024 ** 3, owner: { kind: 'service', name: 'api', engine: null } },
  { name: 'nd-old', sizeBytes: 100, owner: null },
];

describe('Volumes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('shows skeleton while loading', () => {
    mockOf(api.volumes.list).mockReturnValue(new Promise(() => {}));
    mockOf(api.system.resources).mockResolvedValue({} as never);
    renderWithProviders(<Volumes />);
    expect(document.querySelectorAll('.animate-pulse').length).toBe(3);
  });

  it('shows empty state when there are no volumes', async () => {
    mockOf(api.volumes.list).mockResolvedValue([] as never);
    mockOf(api.system.resources).mockResolvedValue({
      network: 'ninedeploy',
      containers: 2,
      volumes: 0,
      imagesSummary: { active: 3, total: 5, size: '1.2 GB', reclaimable: '0B' },
    } as never);
    renderWithProviders(<Volumes />);
    await screen.findByText('No volumes');
    expect(screen.getByText((_, el) => el?.textContent === '0 volumes · — used')).toBeInTheDocument();
    // Docker resources card with metrics
    expect(screen.getByText('ninedeploy')).toBeInTheDocument();
    expect(screen.getByText('3/5 active')).toBeInTheDocument();
  });

  it('renders volume cards with owners, formats and retention', async () => {
    mockOf(api.volumes.list).mockResolvedValue(volumes as never);
    mockOf(api.system.resources).mockResolvedValue({
      network: 'ninedeploy',
      containers: 1,
      volumes: 3,
      imagesSummary: { active: 1, total: 1, size: '10 MB', reclaimable: '2 MB' },
    } as never);
    renderWithProviders(<Volumes />);
    await screen.findByText('db');
    expect(screen.getByText('512.0 MB')).toBeInTheDocument(); // MB branch (512 MiB)
    expect(screen.getByText('2.00 GB')).toBeInTheDocument(); // GB branch
    expect(screen.getByText('Retained')).toBeInTheDocument();
    expect(screen.getByText('no active owner')).toBeInTheDocument();
    expect(screen.getAllByText('attached').length).toBe(2);
    expect(screen.getByText('retained · reusable')).toBeInTheDocument();
    // retained count in subtitle
    expect(screen.getByText(/1 retained/)).toBeInTheDocument();
    // docker resources reclaimable (rendered as literal text incl. <span> markup)
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('2 MB') === true).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Backups' })).toHaveAttribute('href', '/backups');
  });

  it('deletes a volume after confirmation', async () => {
    mockOf(api.volumes.list).mockResolvedValue(volumes as never);
    mockOf(api.system.resources).mockResolvedValue({} as never);
    mockOf(api.volumes.remove).mockResolvedValue(undefined as never);
    renderWithProviders(<Volumes />);
    const trash = await screen.findAllByTitle('Delete volume (destructive)');
    fireEvent.click(trash[0]!);
    await waitFor(() => expect(api.volumes.remove).toHaveBeenCalledWith('nd-data'));
  });

  it('does not delete when confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockOf(api.volumes.list).mockResolvedValue(volumes as never);
    mockOf(api.system.resources).mockResolvedValue({} as never);
    renderWithProviders(<Volumes />);
    const trash = await screen.findAllByTitle('Delete volume (destructive)');
    fireEvent.click(trash[0]!);
    expect(api.volumes.remove).not.toHaveBeenCalled();
  });

  it('prunes images and shows reclaimed resources', async () => {
    mockOf(api.volumes.list).mockResolvedValue(volumes as never);
    mockOf(api.system.resources).mockResolvedValue({
      network: 'ninedeploy',
      containers: 3,
      volumes: 2,
      imagesSummary: { active: 2, total: 4, size: '500 MB', reclaimable: '300 MB' },
    } as never);
    mockOf(api.system.pruneImages).mockResolvedValue({ ok: true } as never);
    renderWithProviders(<Volumes />);
    fireEvent.click(await screen.findByRole('button', { name: /Prune images/ }));
    await waitFor(() => expect(api.system.pruneImages).toHaveBeenCalled());
    // reclaimable is rendered via a template literal containing literal <span> markup
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('300 MB') === true).length).toBeGreaterThan(0);
  });
});
