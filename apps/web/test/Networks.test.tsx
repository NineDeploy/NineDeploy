import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Networks } from '../src/routes/Networks.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const toastSpy = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../src/components/Toast.js', async () => {
  const actual = await vi.importActual<typeof import('../src/components/Toast.js')>('../src/components/Toast.js');
  return { ...actual, useToast: () => toastSpy };
});

const nets = {
  networks: [
    { name: 'ninedeploy', driver: 'bridge', members: ['nd-web-3'] },
    { name: 'back-tier', driver: 'bridge', members: [] },
  ],
};

describe('Networks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(api.networks.list).mockResolvedValue(nets as never);
  });

  it('renders the network cards with member counts', async () => {
    renderWithProviders(<Networks />);
    expect(await screen.findByText('back-tier')).toBeInTheDocument();
    expect(screen.getByText('No attached containers')).toBeInTheDocument();
    expect(screen.getByText('1 container attached')).toBeInTheDocument();
    // The shared network can never be deleted.
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('creates a network via the form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Networks />);
    fireEvent.click(await screen.findByRole('button', { name: /New network/ }));
    await user.type(screen.getByPlaceholderText('my-network'), 'front-tier');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(api.networks.create).toHaveBeenCalledWith({ name: 'front-tier', driver: 'bridge' }),
    );
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Network created', 'success'));
  });

  it('deletes a network only after confirmation', async () => {
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0]!);
    // The confirm dialog is up; nothing deleted yet.
    expect(api.networks.remove).not.toHaveBeenCalled();
    // The dialog's confirm is the LAST Delete button in the DOM.
    const confirm = screen.getAllByRole('button', { name: 'Delete', exact: true }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(api.networks.remove).toHaveBeenCalledWith('back-tier'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Network deleted', 'success'));
  });

  it('attaches and detaches containers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');
    fireEvent.click(screen.getAllByRole('button', { name: /Attach/ })[0]!);
    await user.type(screen.getByPlaceholderText('my-app-42'), 'nd-api-2');
    // The attach-card submit is the FIRST exact-"Attach" button — the form
    // card renders above the network list.
    fireEvent.click(screen.getAllByRole('button', { name: /^Attach$/ })[0]!);
    await waitFor(() => expect(api.networks.attach).toHaveBeenCalledWith({ network: 'ninedeploy', container: 'nd-api-2' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Container attached', 'success'));

    fireEvent.click(screen.getByTitle('Detach'));
    await waitFor(() =>
      expect(api.networks.detach).toHaveBeenCalledWith({ network: 'ninedeploy', container: 'nd-web-3' }),
    );
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Container detached', 'success'));
  });

  it('toasts when deleting a network fails', async () => {
    mockOf(api.networks.remove).mockRejectedValueOnce(new Error('network in use') as never);
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0]!);
    const confirm = screen.getAllByRole('button', { name: 'Delete', exact: true }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('network in use', 'error'));
  });

  it('pluralizes multi-member networks, shows pending labels and generic create errors', async () => {
    const user = userEvent.setup();
    mockOf(api.networks.list).mockResolvedValue({
      networks: [{ name: 'mesh', driver: 'overlay', members: ['nd-a-1', 'nd-b-2'] }],
    } as never);
    // Pending create keeps the button in its "Creating…" state.
    mockOf(api.networks.create).mockReturnValueOnce(new Promise(() => {}) as never);
    const first = renderWithProviders(<Networks />);
    expect(await screen.findByText('2 containers attached')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New network/ }));
    await user.type(screen.getByPlaceholderText('my-network'), 'next-net');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Creating…')).toBeInTheDocument();
    first.unmount();

    // A non-Error rejection uses the generic create message.
    mockOf(api.networks.create).mockRejectedValueOnce('boom' as never);
    renderWithProviders(<Networks />);
    await screen.findByText('mesh');
    fireEvent.click(screen.getByRole('button', { name: /New network/ }));
    await user.type(screen.getByPlaceholderText('my-network'), 'next-net');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Create failed', 'error'));
  });

  it('toasts generic delete and attach failures and a detach error message', async () => {
    const user = userEvent.setup();
    // Attach pending → "Attaching…" label.
    mockOf(api.networks.remove).mockRejectedValueOnce('boom' as never);
    mockOf(api.networks.attach).mockReturnValueOnce(new Promise(() => {}) as never);
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');

    // Delete failure (non-Error → generic).
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete', exact: true }).at(-1)!);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Delete failed', 'error'));

    // Attach in flight shows the pending label.
    fireEvent.click(screen.getAllByRole('button', { name: /Attach/ })[0]!);
    await user.type(screen.getByPlaceholderText('my-app-42'), 'nd-api-2');
    fireEvent.click(screen.getAllByRole('button', { name: /^Attach$/ })[0]!);
    expect(await screen.findByText('Attaching…')).toBeInTheDocument();
  });

  it('toasts a generic attach failure and a detach error message', async () => {
    const user = userEvent.setup();
    mockOf(api.networks.attach).mockRejectedValueOnce('boom' as never);
    mockOf(api.networks.detach).mockRejectedValueOnce(new Error('docker api down') as never);
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');

    // Attach failure (non-Error → generic).
    fireEvent.click(screen.getAllByRole('button', { name: /Attach/ })[0]!);
    await user.type(screen.getByPlaceholderText('my-app-42'), 'nd-api-2');
    fireEvent.click(screen.getAllByRole('button', { name: /^Attach$/ })[0]!);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Attach failed', 'error'));

    // Detach failure (Error → its message).
    fireEvent.click(screen.getByTitle('Detach'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('docker api down', 'error'));
  });

  it('shows the empty state when there are no user networks', async () => {
    mockOf(api.networks.list).mockResolvedValue({ networks: [] } as never);
    renderWithProviders(<Networks />);
    expect(await screen.findByText('No user-defined networks')).toBeInTheDocument();
  });

  it('shows an error card with retry when the list query fails', async () => {
    mockOf(api.networks.list).mockRejectedValue(new Error('docker down') as never);
    renderWithProviders(<Networks />);
    expect(await screen.findByText("Couldn't load networks")).toBeInTheDocument();
    expect(screen.getByText('docker down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.networks.list).toHaveBeenCalledTimes(2));
  });

  it('toasts the server message when create/attach/detach fail', async () => {
    const user = userEvent.setup();
    mockOf(api.networks.create).mockRejectedValueOnce(new Error('name taken') as never);
    mockOf(api.networks.attach).mockRejectedValueOnce(new Error('no such container') as never);
    mockOf(api.networks.detach).mockRejectedValueOnce('boom' as never);
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');

    // create failure (Error → err.message)
    fireEvent.click(screen.getByRole('button', { name: /New network/ }));
    await user.type(screen.getByPlaceholderText('my-network'), 'front-tier');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('name taken', 'error'));

    // attach failure (Error → err.message)
    fireEvent.click(screen.getAllByRole('button', { name: /Attach/ })[0]!);
    await user.type(screen.getByPlaceholderText('my-app-42'), 'nd-api-2');
    fireEvent.click(screen.getAllByRole('button', { name: /^Attach$/ })[0]!);
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('no such container', 'error'));

    // detach failure (non-Error → generic message)
    fireEvent.click(screen.getByTitle('Detach'));
    await waitFor(() => expect(toastSpy.toast).toHaveBeenCalledWith('Detach failed', 'error'));
  });

  it('supports the overlay driver and cancels the attach form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');

    // Driver select change → overlay.
    fireEvent.click(screen.getByRole('button', { name: /New network/ }));
    await user.type(screen.getByPlaceholderText('my-network'), 'mesh-net');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'overlay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.networks.create).toHaveBeenCalledWith({ name: 'mesh-net', driver: 'overlay' }));

    // Attach card opens, Cancel closes it without calling the API.
    fireEvent.click(screen.getAllByRole('button', { name: /Attach/ })[0]!);
    expect(screen.getByPlaceholderText('my-app-42')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('my-app-42')).not.toBeInTheDocument();
    expect(api.networks.attach).not.toHaveBeenCalled();
  });

  it('keeps Create disabled for an invalid network name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');
    fireEvent.click(screen.getByRole('button', { name: /New network/ }));
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await user.type(screen.getByPlaceholderText('my-network'), '-leading-dash');
    expect(create).toBeDisabled();
    await user.clear(screen.getByPlaceholderText('my-network'));
    await user.type(screen.getByPlaceholderText('my-network'), 'ok.name-1');
    expect(create).toBeEnabled();
  });

  it('keeps the shared managed network undeletable and hides its Delete button', async () => {
    renderWithProviders(<Networks />);
    await screen.findByText('back-tier');
    expect(screen.getAllByRole('button', { name: /Delete/ })).toHaveLength(1); // back-tier only
    expect(screen.getByText('managed')).toBeInTheDocument();
  });
});
