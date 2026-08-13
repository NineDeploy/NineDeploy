import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sources } from '../src/routes/Sources.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const sources = [
  { id: 1, name: 'github-personal', type: 'github', hasToken: true, hasDeployKey: false },
  { id: 2, name: 'custom-server', type: 'weird', hasToken: false, hasDeployKey: true },
];

describe('Sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton while loading', () => {
    mockOf(api.sources.list).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Sources />);
    expect(document.querySelectorAll('.animate-pulse').length).toBe(2);
  });

  it('shows empty state when there are no sources', async () => {
    mockOf(api.sources.list).mockResolvedValue([] as never);
    renderWithProviders(<Sources />);
    await screen.findByText('No sources');
  });

  it('renders sources with type labels and credential tags', async () => {
    mockOf(api.sources.list).mockResolvedValue(sources as never);
    renderWithProviders(<Sources />);
    await screen.findByText('github-personal');
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    // unknown type falls back to raw value
    expect(screen.getByText('weird')).toBeInTheDocument();
    expect(screen.getAllByText('Token').length).toBe(2);
    expect(screen.getAllByText('Deploy key').length).toBe(2);
  });

  it('creates a source with token, closes and resets the form', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    mockOf(api.sources.create).mockResolvedValue({ id: 3, name: 'x', type: 'github', hasToken: true, hasDeployKey: false } as never);
    renderWithProviders(<Sources />);
    await user.click(await screen.findByRole('button', { name: /New source/ }));
    await user.type(await screen.findByPlaceholderText('github-personal'), 'my-src');
    await user.selectOptions(screen.getByRole('combobox'), 'gitlab');
    await user.type(screen.getByPlaceholderText('ghp_… / glpat-…'), 'ghp_token');
    await user.click(screen.getByRole('button', { name: /Save source/ }));
    await waitFor(() => expect(api.sources.create).toHaveBeenCalledWith({ name: 'my-src', type: 'gitlab', token: 'ghp_token', deployKey: undefined }));
    expect(screen.queryByPlaceholderText('github-personal')).not.toBeInTheDocument();
  });

  it('creates a source with an SSH deploy key only', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    mockOf(api.sources.create).mockResolvedValue({ id: 4, name: 'k', type: 'github', hasToken: false, hasDeployKey: true } as never);
    renderWithProviders(<Sources />);
    await user.click(await screen.findByRole('button', { name: /New source/ }));
    await user.type(await screen.findByPlaceholderText('github-personal'), 'ssh-src');
    await user.type(screen.getByPlaceholderText('-----BEGIN OPENSSH PRIVATE KEY-----'), 'PRIVATE KEY');
    await user.click(screen.getByRole('button', { name: /Save source/ }));
    await waitFor(() => expect(api.sources.create).toHaveBeenCalledWith({ name: 'ssh-src', type: 'github', token: undefined, deployKey: 'PRIVATE KEY' }));
  });

  it('shows the saving label while the source is being created', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    mockOf(api.sources.create).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Sources />);
    await user.click(await screen.findByRole('button', { name: /New source/ }));
    await user.type(await screen.findByPlaceholderText('github-personal'), 'x');
    await user.type(screen.getByPlaceholderText('ghp_… / glpat-…'), 'tok');
    await user.click(screen.getByRole('button', { name: /Save source/ }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
  });

  it('does not submit when name or credentials are missing', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    renderWithProviders(<Sources />);
    await user.click(await screen.findByRole('button', { name: /New source/ }));
    await user.click(screen.getByRole('button', { name: /Save source/ }));
    expect(api.sources.create).not.toHaveBeenCalled();
  });

  it('does not submit when only a name is provided', async () => {
    mockOf(api.sources.list).mockResolvedValue([] as never);
    renderWithProviders(<Sources />);
    fireEvent.click(await screen.findByRole('button', { name: /New source/ }));
    // bypass the disabled button by submitting the form directly
    const input = await screen.findByPlaceholderText('github-personal');
    await userEvent.type(input, 'no-creds');
    fireEvent.submit(input.closest('form')!);
    expect(api.sources.create).not.toHaveBeenCalled();
  });

  it('removes a source', async () => {
    mockOf(api.sources.list).mockResolvedValue(sources as never);
    mockOf(api.sources.remove).mockResolvedValue(undefined as never);
    renderWithProviders(<Sources />);
    await screen.findByText('github-personal');
    // trash buttons render a Trash2 svg inside a <button>
    const buttons = screen.getAllByRole('button');
    const trash = buttons.find((b) => b.querySelector('svg') !== null && b.className.includes('hover:text-rose-400'))!;
    await userEvent.click(trash);
    await waitFor(() => expect(api.sources.remove).toHaveBeenCalledWith(1));
  });
});
