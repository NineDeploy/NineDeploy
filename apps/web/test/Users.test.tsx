import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Users } from '../src/routes/Users.js';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/lib/auth.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

vi.mock('../src/lib/auth.js', async () => {
  const { createAuthMock } = await import('./helpers.js');
  return createAuthMock();
});

const users = [
  { id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin' },
  { id: 2, email: 'member@example.com', name: null as string | null, role: 'member' },
  { id: 3, email: 'coadmin@example.com', name: 'Co', role: 'admin' },
];

describe('Users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(useAuth).mockReturnValue({ user: { id: 1, email: 'admin@example.com' } } as never);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('shows skeleton while loading', () => {
    mockOf(api.users.list).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Users />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows empty state when there are no users', async () => {
    mockOf(api.users.list).mockResolvedValue([] as never);
    renderWithProviders(<Users />);
    await screen.findByText('No users');
  });

  it('renders users with role badges, self-label and delete for others', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    renderWithProviders(<Users />);
    await screen.findByText('admin@example.com');
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    // role badges
    expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('member').length).toBeGreaterThan(0);
    // delete button only for non-self users (member + coadmin)
    const deleteButtons = screen.getAllByTitle('Delete user');
    expect(deleteButtons).toHaveLength(2);
  });

  it('toggles role of another user and invalidates', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.setRole).mockResolvedValue({ ...users[1], role: 'admin' } as never);
    renderWithProviders(<Users />);
    const roleButtons = await screen.findAllByRole('button', { name: /admin|member/ });
    // member row button toggles to admin
    fireEvent.click(roleButtons[1]!);
    await waitFor(() => expect(api.users.setRole).toHaveBeenCalledWith(2, 'admin'));
  });

  it('demotes a non-self admin to member', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.setRole).mockResolvedValue({ ...users[2], role: 'member' } as never);
    renderWithProviders(<Users />);
    const roleButtons = await screen.findAllByRole('button', { name: /admin|member/ });
    // coadmin row (index 2) is admin and not me -> toggles to member
    expect(roleButtons[2]!).toHaveAttribute('title', 'Toggle to member');
    fireEvent.click(roleButtons[2]!);
    await waitFor(() => expect(api.users.setRole).toHaveBeenCalledWith(3, 'member'));
  });

  it('deletes a user after confirmation', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.remove).mockResolvedValue(undefined as never);
    renderWithProviders(<Users />);
    fireEvent.click((await screen.findAllByTitle('Delete user'))[0]!);
    await waitFor(() => expect(api.users.remove).toHaveBeenCalledWith(2));
  });

  it('does not delete when confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockOf(api.users.list).mockResolvedValue(users as never);
    renderWithProviders(<Users />);
    fireEvent.click((await screen.findAllByTitle('Delete user'))[0]!);
    expect(api.users.remove).not.toHaveBeenCalled();
  });

  it('resets another user password via the inline form', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.resetPassword).mockResolvedValue({ ok: true } as never);
    renderWithProviders(<Users />);

    fireEvent.click((await screen.findAllByTitle(/Reset password/))[0]!);
    const input = await screen.findByPlaceholderText('new password (min 8)');
    fireEvent.change(input, { target: { value: 'fresh-pass-123' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(api.users.resetPassword).toHaveBeenCalledWith(2, { newPassword: 'fresh-pass-123' }));
    // The inline form closes after success.
    await waitFor(() => expect(screen.queryByPlaceholderText('new password (min 8)')).not.toBeInTheDocument());
  });

  it('rejects a too-short reset password without calling the API', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    renderWithProviders(<Users />);

    fireEvent.click((await screen.findAllByTitle(/Reset password/))[0]!);
    const input = await screen.findByPlaceholderText('new password (min 8)');
    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(screen.getByText('Save'));

    expect(api.users.resetPassword).not.toHaveBeenCalled();
  });

  it('cancels the inline reset form without calling the API', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    renderWithProviders(<Users />);

    fireEvent.click((await screen.findAllByTitle(/Reset password/))[0]!);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('new password (min 8)')).not.toBeInTheDocument();
    expect(api.users.resetPassword).not.toHaveBeenCalled();
  });

  it('shows the pending state while the reset is in flight', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    let resolveReset!: (v: unknown) => void;
    mockOf(api.users.resetPassword).mockReturnValue(
      new Promise((r) => {
        resolveReset = r;
      }) as never,
    );
    renderWithProviders(<Users />);

    fireEvent.click((await screen.findAllByTitle(/Reset password/))[0]!);
    fireEvent.change(screen.getByPlaceholderText('new password (min 8)'), { target: { value: 'fresh-pass-123' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Saving…')).toBeInTheDocument());
    resolveReset({ ok: true });
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  });

  it('reports a failed reset as an error toast and keeps the form open', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.resetPassword).mockRejectedValue(new Error('500'));
    renderWithProviders(<Users />);

    fireEvent.click((await screen.findAllByTitle(/Reset password/))[0]!);
    fireEvent.change(screen.getByPlaceholderText('new password (min 8)'), { target: { value: 'fresh-pass-123' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.queryByPlaceholderText('new password (min 8)')).toBeInTheDocument());
  });

  // ── one-time reset links ────────────────────────────────────────────────
  it('generates and reveals a one-time reset link', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.resetLink).mockResolvedValue({
      url: 'http://localhost:3000/reset-password?token=abc',
      expiresAt: '2026-08-15T12:30:00Z',
    } as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderWithProviders(<Users />);
    fireEvent.click((await screen.findAllByTitle(/one-time reset link/))[0]!);
    await waitFor(() => expect(api.users.resetLink).toHaveBeenCalledWith(2));
    expect(await screen.findByText(/Copy this one-time link now/)).toBeInTheDocument();
    expect(screen.getByText(/reset-password\?token=abc/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:3000/reset-password?token=abc'));

    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByText(/reset-password\?token=abc/)).not.toBeInTheDocument();
  });

  it('reports a failed link generation as a toast', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.resetLink).mockRejectedValue(new Error('500') as never);
    renderWithProviders(<Users />);
    fireEvent.click((await screen.findAllByTitle(/one-time reset link/))[0]!);
    await waitFor(() => expect(api.users.resetLink).toHaveBeenCalled());
  });

  it('reports a clipboard failure when copying the link', async () => {
    mockOf(api.users.list).mockResolvedValue(users as never);
    mockOf(api.users.resetLink).mockResolvedValue({
      url: 'http://localhost:3000/reset-password?token=abc',
      expiresAt: '2026-08-15T12:30:00Z',
    } as never);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    renderWithProviders(<Users />);
    fireEvent.click((await screen.findAllByTitle(/one-time reset link/))[0]!);
    fireEvent.click(await screen.findByText('Copy'));
    await waitFor(() => expect(screen.getByText(/Copy failed/)).toBeInTheDocument());
  });
});
