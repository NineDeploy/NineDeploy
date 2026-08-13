import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tunnels } from '../src/routes/Tunnels.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const tunnels = [
  { id: 1, name: 'production', token: 'tok', status: 'running', containerName: 'nd-tunnel-1' },
  { id: 2, name: 'staging', token: 'tok2', status: 'error', containerName: null as string | null },
];

describe('Tunnels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton while loading', () => {
    mockOf(api.tunnels.list).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Tunnels />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows empty state when there are no tunnels', async () => {
    mockOf(api.tunnels.list).mockResolvedValue([] as never);
    renderWithProviders(<Tunnels />);
    await screen.findByText('No tunnels');
    expect(screen.getByText(/Add a Cloudflare Tunnel token/)).toBeInTheDocument();
  });

  it('renders the tunnel table with statuses and containers', async () => {
    mockOf(api.tunnels.list).mockResolvedValue(tunnels as never);
    renderWithProviders(<Tunnels />);
    await screen.findByText('production');
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('nd-tunnel-1')).toBeInTheDocument();
  });

  it('creates a tunnel via the form and resets it', async () => {
    const user = userEvent.setup();
    mockOf(api.tunnels.list).mockResolvedValue([] as never);
    mockOf(api.tunnels.create).mockResolvedValue({ id: 3, name: 'new', token: 't', status: 'running', containerName: 'c' } as never);
    renderWithProviders(<Tunnels />);
    await user.click(await screen.findByRole('button', { name: /New tunnel/ }));
    await user.type(await screen.findByPlaceholderText('production'), 'edge');
    await user.type(screen.getByPlaceholderText('eyJhIjoi…'), 'secret-token');
    await user.click(screen.getByRole('button', { name: /Start tunnel/ }));
    await waitFor(() => expect(api.tunnels.create).toHaveBeenCalledWith({ name: 'edge', token: 'secret-token' }));
    // form closes on success
    expect(screen.queryByPlaceholderText('production')).not.toBeInTheDocument();
  });

  it('does not submit the tunnel form when fields are empty', async () => {
    const user = userEvent.setup();
    mockOf(api.tunnels.list).mockResolvedValue([] as never);
    renderWithProviders(<Tunnels />);
    await user.click(await screen.findByRole('button', { name: /New tunnel/ }));
    await user.click(screen.getByRole('button', { name: /Start tunnel/ }));
    expect(api.tunnels.create).not.toHaveBeenCalled();
  });

  it('does not submit the tunnel form when only a name is provided', async () => {
    mockOf(api.tunnels.list).mockResolvedValue([] as never);
    renderWithProviders(<Tunnels />);
    fireEvent.click(await screen.findByRole('button', { name: /New tunnel/ }));
    const input = await screen.findByPlaceholderText('production');
    await userEvent.type(input, 'edge');
    fireEvent.submit(input.closest('form')!);
    expect(api.tunnels.create).not.toHaveBeenCalled();
  });

  it('shows the starting label while a tunnel is being created', async () => {
    const user = userEvent.setup();
    mockOf(api.tunnels.list).mockResolvedValue([] as never);
    mockOf(api.tunnels.create).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Tunnels />);
    await user.click(await screen.findByRole('button', { name: /New tunnel/ }));
    await user.type(await screen.findByPlaceholderText('production'), 'edge');
    await user.type(screen.getByPlaceholderText('eyJhIjoi…'), 'tok');
    await user.click(screen.getByRole('button', { name: /Start tunnel/ }));
    expect(await screen.findByText('Starting…')).toBeInTheDocument();
  });

  it('removes a tunnel', async () => {
    mockOf(api.tunnels.list).mockResolvedValue(tunnels as never);
    mockOf(api.tunnels.remove).mockResolvedValue(undefined as never);
    renderWithProviders(<Tunnels />);
    await screen.findByText('production');
    const deleteButtons = screen.getAllByRole('button').filter((b) => b.textContent?.trim() === '');
    fireEvent.click(deleteButtons[0]!);
    await waitFor(() => expect(api.tunnels.remove).toHaveBeenCalledWith(1));
  });
});
