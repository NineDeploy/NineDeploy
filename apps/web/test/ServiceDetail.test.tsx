import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceDetail } from '../src/routes/ServiceDetail.js';
import { api, getToken } from '../src/lib/api.js';
import { renderRoute, renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

vi.mock('../src/lib/useDeployLogs.js', () => ({
  useDeployLogs: vi.fn(() => ({ lines: '', open: false })),
}));

const toastSpy = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../src/components/Toast.js', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastSpy,
}));

vi.mock('../src/components/ContainerTerminal.js', () => ({
  ContainerTerminal: ({ serviceId, onClose }: { serviceId: number; onClose: () => void }) => (
    <div data-testid="terminal">
      terminal-{serviceId}
      <button onClick={onClose}>close terminal</button>
    </div>
  ),
}));

vi.mock('../src/components/EnvCard.js', () => ({
  EnvCard: () => <div data-testid="env-card">env</div>,
}));

vi.mock('../src/components/AttachmentsCard.js', () => ({
  AttachmentsCard: () => <div data-testid="attachments-card">attachments</div>,
}));

const service = {
  id: 1,
  name: 'api',
  slug: 'api',
  type: 'docker',
  branch: 'main',
  port: 3000,
  repoUrl: 'https://github.com/x/y',
  autoUrl: 'api.nd.local',
  status: 'running',
  runtimeId: 'nd-api',
};

const deploys = [
  { id: 5, serviceId: 1, status: 'running', commitSha: 'abcdef1234', message: null, trigger: 'manual', finishedAt: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 4, serviceId: 1, status: 'failed', commitSha: null, message: null, trigger: 'webhook', finishedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
];

const domains = [
  { id: 1, hostname: 'app.example.com', path: '/', serviceId: 1, serviceName: 'api', port: 3000, container: 'nd-api', ssl: true, status: 'active' },
];

const webhooks = [
  { id: 1, serviceId: 1, branch: 'main', url: 'https://hook.example.com/1', secret: 's3cret', createdAt: 'x' },
];

describe('ServiceDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSpy.toast.mockClear();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn());
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    mockOf(api.services.get).mockResolvedValue(service as never);
    mockOf(api.deploys.list).mockResolvedValue(deploys as never);
    mockOf(api.domains.list).mockResolvedValue(domains as never);
    mockOf(api.webhooks.list).mockResolvedValue(webhooks as never);
  });

  it('shows skeleton while the service loads', () => {
    mockOf(api.services.get).mockReturnValue(new Promise(() => {}));
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders service header with status, auto URL and deploy actions', async () => {
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByRole('heading', { name: 'api' });
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    expect(screen.getByText('docker')).toBeInTheDocument();
    expect(screen.getByText(': 3000')).toBeInTheDocument();
    expect(screen.getByText('https://github.com/x/y')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'api.nd.local' })).toHaveAttribute('href', 'http://api.nd.local');
    // running -> restart + stop buttons
    expect(screen.getByRole('button', { name: /Restart/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();
    // runtimeId present -> logs and exec buttons
    expect(screen.getByRole('button', { name: /Runtime logs/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exec/ })).toBeInTheDocument();
    // live log panel with active deploy auto-selected (latest)
    expect(await screen.findByText(/deploy #5/)).toBeInTheDocument();
    // commitSha fallback: deploy #4 has null commitSha -> '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // cards
    expect(screen.getByTestId('env-card')).toBeInTheDocument();
    expect(screen.getByTestId('attachments-card')).toBeInTheDocument();
  });

  it('triggers a deploy and shows pending state', async () => {
    mockOf(api.deploys.trigger).mockResolvedValue({ deploymentId: 9 } as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    fireEvent.click(await screen.findByRole('button', { name: /Deploy/ }));
    await waitFor(() => expect(api.deploys.trigger).toHaveBeenCalledWith(1));
  });

  it('shows the pending label while a deploy is being triggered', async () => {
    mockOf(api.deploys.trigger).mockReturnValue(new Promise(() => {}) as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    fireEvent.click(await screen.findByRole('button', { name: /Deploy/ }));
    expect(await screen.findByText('Triggering…')).toBeInTheDocument();
  });

  it('polls faster while the service is deploying', async () => {
    mockOf(api.services.get).mockResolvedValue({ ...service, status: 'deploying' } as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByRole('heading', { name: 'api' });
    expect(screen.getAllByText('deploying').length).toBeGreaterThan(0);
  });

  it('runs lifecycle actions (restart/stop for running, start for stopped)', async () => {
    mockOf(api.services.restart).mockResolvedValue({ ok: true, status: 'running' } as never);
    mockOf(api.services.stop).mockResolvedValue({ ok: true, status: 'stopped' } as never);
    const first = renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    fireEvent.click(await screen.findByRole('button', { name: /Restart/ }));
    await waitFor(() => expect(api.services.restart).toHaveBeenCalledWith(1));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Service restarted', 'success'));
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(api.services.stop).toHaveBeenCalledWith(1));
    // source interpolates `${action}ed` -> "stoped"
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Service stoped', 'success'));
    first.unmount();

    // stopped service -> start action
    mockOf(api.services.get).mockResolvedValue({ ...service, status: 'stopped', autoUrl: null, runtimeId: null } as never);
    mockOf(api.services.start).mockResolvedValue({ ok: true, status: 'running' } as never);
    const { unmount } = renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByRole('button', { name: /Start/ });
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(api.services.start).toHaveBeenCalledWith(1));
    // no restart/stop when stopped; no logs/exec buttons without runtimeId
    expect(screen.queryByRole('button', { name: /Restart/ })).not.toBeInTheDocument();
    unmount();
  });

  it('reports lifecycle failure via toast', async () => {
    mockOf(api.services.restart).mockRejectedValue(new Error('nope'));
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    fireEvent.click(await screen.findByRole('button', { name: /Restart/ }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Action failed', 'error'));
  });

  it('toggles runtime logs and shows their content', async () => {
    mockOf(api.services.logs).mockResolvedValue({ lines: 'line one\nline two' } as never);
    const user = userEvent.setup();
    mockOf((await import('../src/lib/useDeployLogs.js')).useDeployLogs).mockReturnValue({ lines: 'deploy log line', open: true });
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await user.click(await screen.findByRole('button', { name: /Runtime logs/ }));
    await screen.findByText((content, el) => el?.textContent === 'line one\nline two');
    // toggle to hide
    await user.click(screen.getByRole('button', { name: /Hide logs/ }));
    expect(screen.queryByText('line one')).not.toBeInTheDocument();
  });

  it('shows the empty runtime logs placeholder', async () => {
    mockOf(api.services.logs).mockResolvedValue({ lines: '' } as never);
    const user = userEvent.setup();
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await user.click(await screen.findByRole('button', { name: /Runtime logs/ }));
    await screen.findByText('No logs yet.');
  });

  it('shows the deploy log panel open with lines and auto-scrolls', async () => {
    // Key the mock on the deploymentId so `lines` changes exactly when the
    // active deploy is selected: the auto-scroll effect (deps [content, ref])
    // only re-runs when content changes, which is when the <pre> mounts.
    mockOf((await import('../src/lib/useDeployLogs.js')).useDeployLogs).mockImplementation(
      (_svc: number | null, depId: number | null) =>
        depId == null ? { lines: '', open: false } : { lines: 'line one\nline two', open: true },
    );
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText((content, el) => el?.textContent === 'line one\nline two');
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('renders an empty log panel when open with no lines', async () => {
    mockOf((await import('../src/lib/useDeployLogs.js')).useDeployLogs).mockReturnValue({ lines: '', open: true });
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    // open=true with empty lines renders '' instead of 'Connecting…'
    await screen.findByText(/deploy #5/);
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('opens and closes the exec terminal', async () => {
    const user = userEvent.setup();
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await user.click(await screen.findByRole('button', { name: /Exec/ }));
    expect(screen.getByTestId('terminal')).toHaveTextContent('terminal-1');
    await user.click(screen.getByRole('button', { name: 'close terminal' }));
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument();
  });

  it('exports the service and reports failures', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) } as Response);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    fireEvent.click(await screen.findByRole('button', { name: /Export/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/services/1/export', expect.anything()));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${getToken()}` });
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Service exported', 'success'));

    fetchMock.mockResolvedValueOnce({ ok: false } as Response);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Export failed', 'error'));
  });

  it('exports with fallback token and filename when missing', async () => {
    mockOf(getToken).mockReturnValue(null);
    mockOf(api.services.get).mockResolvedValue({ ...service, slug: null } as never);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['x']) } as Response);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    fireEvent.click(await screen.findByRole('button', { name: /Export/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer ' });
  });

  it('adds and removes domains on the service', async () => {
    const user = userEvent.setup();
    mockOf(api.domains.create).mockResolvedValue({ id: 2, hostname: 'new.example.com' } as never);
    mockOf(api.domains.remove).mockResolvedValue(undefined as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText('app.example.com');
    await user.type(screen.getByPlaceholderText('app.example.com'), 'new.example.com');
    await user.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect(api.domains.create).toHaveBeenCalledWith(1, { hostname: 'new.example.com' }));
    fireEvent.click(screen.getByTitle('Remove domain'));
    await waitFor(() => expect(api.domains.remove).toHaveBeenCalledWith(1, 1));
  });

  it('does not add an empty domain', async () => {
    const user = userEvent.setup();
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    const addButton = await screen.findByRole('button', { name: /Add/ });
    expect(addButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText('app.example.com'), '   ');
    expect(addButton).toBeDisabled();
    // submitting the form with a blank hostname does not call create
    fireEvent.submit(addButton.closest('form')!);
    expect(api.domains.create).not.toHaveBeenCalled();
  });

  it('shows domain empty state and creates webhooks with revealed secret', async () => {
    const user = userEvent.setup();
    // user-event installs its own clipboard polyfill; re-mock after setup
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockOf(api.domains.list).mockResolvedValue([] as never);
    mockOf(api.webhooks.list).mockResolvedValue([] as never);
    mockOf(api.webhooks.create).mockResolvedValue({ id: 3, url: 'https://hook.example.com/3', secret: 'newsecret', branch: 'main' } as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText('No domains attached.');
    expect(screen.getByText('No webhooks. Create one and add it to GitHub/GitLab.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /New/ }));
    await waitFor(() => expect(api.webhooks.create).toHaveBeenCalledWith(1));
    expect(await screen.findByText('Copy these now — the secret is shown only once.')).toBeInTheDocument();
    expect(screen.getByText('https://hook.example.com/3')).toBeInTheDocument();
    expect(screen.getByText('newsecret')).toBeInTheDocument();
    // copy the URL from the revealed row
    const urlRow = screen.getByText('https://hook.example.com/3').closest('div')!;
    const urlCopyButton = urlRow.querySelector('button')!;
    fireEvent.click(urlCopyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://hook.example.com/3'));
    expect(urlCopyButton.querySelector('.lucide-check')).not.toBeNull();
    // copy the secret from its row (covers the secret copy handler)
    const secretRow = screen.getByText('newsecret').closest('div')!;
    const secretCopyButton = secretRow.querySelector('button')!;
    fireEvent.click(secretCopyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('newsecret'));
    // the copied indicator resets after the 1500ms timeout
    await waitFor(() => expect(secretCopyButton.querySelector('.lucide-check')).toBeNull(), { timeout: 2500 });
    // dismiss the revealed box
    await user.click(screen.getByRole('button', { name: /saved it/ }));
    expect(screen.queryByText('newsecret')).not.toBeInTheDocument();
  });

  it('removes a webhook and copies its url', async () => {
    const user = userEvent.setup();
    // user-event installs its own clipboard polyfill; re-mock after setup
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockOf(api.webhooks.remove).mockResolvedValue(undefined as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findAllByText('main');
    fireEvent.click(screen.getByTitle('Remove webhook'));
    await waitFor(() => expect(api.webhooks.remove).toHaveBeenCalledWith(1, 1));
    // copy url button on the webhook row
    const copyButton = screen.getByTitle('https://hook.example.com/1');
    await user.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://hook.example.com/1'));
  });

  it('selects a deployment row when clicked', async () => {
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    // active deploy auto-selects the latest (#5); click row #4 to select it
    const row4 = await screen.findByText('#4');
    fireEvent.click(row4.closest('button')!);
    // the log panel header now shows the selected deployment
    await screen.findByText(/deploy #4/);
  });

  it('rolls back to an earlier running deployment', async () => {
    mockOf(api.deploys.rollback).mockResolvedValue({ deploymentId: 7 } as never);
    const deploysWithOld = [
      { ...deploys[0], status: 'running' },
      { ...deploys[1], status: 'running', id: 4 },
    ];
    mockOf(api.deploys.list).mockResolvedValue(deploysWithOld as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText('#5');
    fireEvent.click(await screen.findByTitle('Rollback to #4'));
    await waitFor(() => expect(api.deploys.rollback).toHaveBeenCalledWith(1, 4));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Rollback started', 'info'));
  });

  it('shows deployment list empty and loading states', async () => {
    mockOf(api.deploys.list).mockReturnValue(new Promise(() => {}) as never);
    const { unmount } = renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText('Deployments');
    expect(screen.getByText('Trigger a deploy to see live logs.')).toBeInTheDocument();
    unmount();

    mockOf(api.deploys.list).mockResolvedValue([] as never);
    renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText('No deployments yet.');
  });

  it('invalidates the service when an in-flight deploy becomes terminal', async () => {
    // first list returns an in-flight deploy, second returns terminal
    mockOf(api.deploys.list).mockResolvedValueOnce([{ ...deploys[0], status: 'building' }] as never);
    const { queryClient } = renderRoute(<ServiceDetail />, { path: '/services/:id', route: '/services/1' });
    await screen.findByText('#5');
    expect(screen.getAllByText('building').length).toBeGreaterThan(0);
    // now the deploy finishes
    mockOf(api.deploys.list).mockResolvedValue([{ ...deploys[0], status: 'running' }] as never);
    await act(async () => {
      queryClient.setQueryData(['deploys', 1], [{ ...deploys[0], status: 'running' }]);
      await queryClient.refetchQueries({ queryKey: ['deploys', 1] });
    });
    // the transition effect invalidates the service query -> refetch
    await waitFor(() => expect(api.services.get).toHaveBeenCalledTimes(2));
  });
});
