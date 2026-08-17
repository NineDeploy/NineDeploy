import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Servers } from '../src/routes/Servers.js';
import { api } from '../src/lib/api.js';
import { mockOf, renderWithProviders } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const toastSpy = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../src/components/Toast.js', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastSpy,
}));

const servers = [
  { id: 1, name: 'edge-1', host: '10.0.0.5', port: 4600, status: 'online', lastSeenAt: '2026-01-01T00:00:00Z' },
  { id: 2, name: 'edge-2', host: '10.0.0.6', port: 4600, status: 'offline', lastSeenAt: null },
];

describe('Servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSpy.toast.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('shows the empty state when no servers are registered', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    renderWithProviders(<Servers />);
    expect(await screen.findByText('No remote servers')).toBeInTheDocument();
  });

  it('shows an error card with retry when the servers query fails', async () => {
    mockOf(api.servers.list).mockRejectedValue(new Error('agent down') as never);
    renderWithProviders(<Servers />);
    expect(await screen.findByText("Couldn't load servers")).toBeInTheDocument();
    expect(screen.getByText('agent down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.servers.list).toHaveBeenCalledTimes(2));
  });

  it('lists servers with status badges', async () => {
    mockOf(api.servers.list).mockResolvedValue(servers as never);
    renderWithProviders(<Servers />);
    expect(await screen.findByText('edge-1')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5:4600')).toBeInTheDocument();
    expect(screen.getByText('online', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('offline', { exact: false })).toBeInTheDocument();
  });

  it('registers a server and reveals the one-time agent command', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockResolvedValue({
      id: 3, token: 'raw-tok', tokenSha256: 'a'.repeat(64),
      agentCommand: 'NINEDEPLOY_AGENT=1 …',
    } as never);
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'edge-3' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: '10.0.0.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    await waitFor(() => expect(api.servers.create).toHaveBeenCalledWith({ name: 'edge-3', host: '10.0.0.7', port: 4600 }));
    expect(await screen.findByText(/Copy these now/)).toBeInTheDocument();
    expect(screen.getAllByText(/NINEDEPLOY_AGENT=1/).length).toBeGreaterThan(0);
  });

  it('keeps the register button disabled with incomplete input', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    expect(screen.getByRole('button', { name: 'Register server' })).toBeDisabled();
    fireEvent.submit(screen.getByPlaceholderText('edge-1').closest('form')!);
    expect(api.servers.create).not.toHaveBeenCalled();
  });

  it('tests and removes servers', async () => {
    mockOf(api.servers.list).mockResolvedValue(servers as never);
    mockOf(api.servers.test).mockResolvedValue({ ok: true, status: 'online' } as never);
    renderWithProviders(<Servers />);
    fireEvent.click((await screen.findAllByTitle('Test connectivity'))[0]!);
    await waitFor(() => expect(api.servers.test).toHaveBeenCalledWith(1));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Agent reachable — marked online', 'success'));
    mockOf(api.servers.test).mockRejectedValue(new Error('x') as never);
    fireEvent.click(screen.getAllByTitle('Test connectivity')[0]!);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Agent unreachable', 'error'));
    fireEvent.click(screen.getAllByTitle('Remove server')[0]!);
    // Removal goes through the shared confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.servers.remove).toHaveBeenCalledWith(1, { force: true }));
  });

  it('toasts on remove failures', async () => {
    mockOf(api.servers.list).mockResolvedValue(servers as never);
    mockOf(api.servers.remove).mockRejectedValue(new Error('busy') as never);
    renderWithProviders(<Servers />);
    fireEvent.click((await screen.findAllByTitle('Remove server'))[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not remove the server', 'error'));
  });

  it('reports registration failures', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockRejectedValue(new Error('dup') as never);
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Could not register the server', 'error'));
  });

  it('shows the pending label and the error status badge', async () => {
    mockOf(api.servers.list).mockResolvedValue([
      { id: 3, name: 'dead', host: '10.0.0.9', port: 4600, status: 'error', lastSeenAt: null },
    ] as never);
    mockOf(api.servers.create).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Servers />);
    expect(await screen.findByText('error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.submit(screen.getByPlaceholderText('edge-1').closest('form')!);
    expect(await screen.findByText('Registering…')).toBeInTheDocument();
  });

  it('falls back to 4600 when the port field is emptied', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockResolvedValue({
      id: 7, token: 't', tokenSha256: 'e'.repeat(64), agentCommand: 'x',
    } as never);
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.change(screen.getByDisplayValue('4600'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    await waitFor(() => expect(api.servers.create).toHaveBeenCalledWith({ name: 'x', host: 'h', port: 4600 }));
    // The revealed command also falls back to the default port.
    expect(await screen.findByText(/NINEDEPLOY_AGENT_PORT=4600/)).toBeInTheDocument();
  });

  it('accepts a custom agent port', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockResolvedValue({
      id: 8, token: 't', tokenSha256: 'd'.repeat(64), agentCommand: 'x',
    } as never);
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.change(screen.getByDisplayValue('4600'), { target: { value: '4700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    await waitFor(() => expect(api.servers.create).toHaveBeenCalledWith({ name: 'x', host: 'h', port: 4700 }));
    // The revealed command always shows the default port hint.
    await waitFor(() =>
      expect(Array.from(document.querySelectorAll('code')).some((c) => c.textContent?.includes('NINEDEPLOY_AGENT_PORT=4600'))).toBe(true));
  });

  it('cancels out of the add form and dismisses the reveal banner', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('edge-1')).not.toBeInTheDocument();

    // Reveal banner dismiss.
    mockOf(api.servers.create).mockResolvedValue({
      id: 4, token: 't', tokenSha256: 'b'.repeat(64), agentCommand: 'x',
    } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    fireEvent.click(await screen.findByText('Done'));
    expect(screen.queryByText(/Copy these now/)).not.toBeInTheDocument();
  });

  it('reports clipboard failures and shows the copied state', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockResolvedValue({
      id: 5, token: 't', tokenSha256: 'c'.repeat(64), agentCommand: 'x',
    } as never);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined) },
      configurable: true,
    });
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    // A rejected clipboard write silently keeps the idle label (useCopy).
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    const btn = await screen.findByRole('button', { name: 'Copy command' });
    expect(btn.textContent).toContain('Copied!');
    // The copied indicator resets after the 1500ms timeout.
    await waitFor(() => expect(btn.textContent).not.toContain('Copied'), { timeout: 2500 });
  });

  it('copies the agent command to the clipboard', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockResolvedValue({
      id: 3, token: 'raw-tok', tokenSha256: 'a'.repeat(64), agentCommand: 'x',
    } as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<Servers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('NINEDEPLOY_AGENT=1')));
  });

  it('copies the auto-join command and toggles between docker and npx tabs', async () => {
    mockOf(api.servers.list).mockResolvedValue([] as never);
    mockOf(api.servers.create).mockResolvedValue({
      id: 3, token: 'raw-tok', tokenSha256: 'a'.repeat(64), agentCommand: 'x',
    } as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<Servers />);
    
    // Copy auto-join command
    fireEvent.click(await screen.findByRole('button', { name: /Copy Auto-Join Command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('NINEDEPLOY_MASTER_URL')));

    // Open add server and switch tabs
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('edge-1'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('10.0.0.5'), { target: { value: 'h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register server' }));

    // Switch to NPX tab
    fireEvent.click(await screen.findByRole('button', { name: 'NPX / Node' }));
    expect(screen.getByText(/npx -y @ninedeploy\/server/)).toBeInTheDocument();

    // Switch back to Docker tab
    fireEvent.click(screen.getByRole('button', { name: /Docker/i }));
    expect(screen.getAllByText(/docker run -d --name ninedeploy-agent/).length).toBeGreaterThanOrEqual(1);
  });

  it('approves a discovered pending node and toasts on success or failure', async () => {
    mockOf(api.servers.list).mockResolvedValue([
      { id: 9, name: 'discovered-node', host: '192.168.1.100', port: 4600, status: 'pending', lastSeenAt: null },
    ] as never);
    mockOf(api.servers.approve).mockResolvedValue({ ok: true, status: 'online' } as never);

    renderWithProviders(<Servers />);
    expect(await screen.findByText('discovered-node')).toBeInTheDocument();
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Approve & Connect/i }));
    await waitFor(() => expect(api.servers.approve).toHaveBeenCalledWith(9));

    // Error case
    mockOf(api.servers.approve).mockRejectedValueOnce(new Error('Agent timed out'));
    fireEvent.click(screen.getByRole('button', { name: /Approve & Connect/i }));
    await waitFor(() => expect(api.servers.approve).toHaveBeenCalledTimes(2));

    // Non-error throw
    mockOf(api.servers.approve).mockRejectedValueOnce('unreachable');
    fireEvent.click(screen.getByRole('button', { name: /Approve & Connect/i }));
    await waitFor(() => expect(api.servers.approve).toHaveBeenCalledTimes(3));
  });

  it('shows verifying label while approval is in flight', async () => {
    mockOf(api.servers.list).mockResolvedValue([
      { id: 9, name: 'discovered-node', host: '192.168.1.100', port: 4600, status: 'pending', lastSeenAt: null },
    ] as never);
    let resolveApprove: (v: unknown) => void;
    mockOf(api.servers.approve).mockImplementationOnce(() => new Promise((resolve) => { resolveApprove = resolve; }));
    renderWithProviders(<Servers />);
    expect(await screen.findByText('discovered-node')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve & Connect/i }));
    await waitFor(() => expect(screen.getByText(/Verifying/)).toBeInTheDocument());
    resolveApprove!({ ok: true, status: 'online' });
    await waitFor(() => expect(screen.queryByText(/Verifying/)).not.toBeInTheDocument());
  });

  it('rejects a discovered pending node and toasts on success or failure', async () => {
    mockOf(api.servers.list).mockResolvedValue([
      { id: 10, name: 'rogue-node', host: '192.168.1.101', port: 4600, status: 'pending', lastSeenAt: null },
    ] as never);
    mockOf(api.servers.reject).mockResolvedValue({ ok: true } as never);

    renderWithProviders(<Servers />);
    expect(await screen.findByText('rogue-node')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    await waitFor(() => expect(api.servers.reject).toHaveBeenCalledWith(10));

    // Error case
    mockOf(api.servers.reject).mockRejectedValueOnce(new Error('fail'));
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    await waitFor(() => expect(api.servers.reject).toHaveBeenCalledTimes(2));
  });
});
