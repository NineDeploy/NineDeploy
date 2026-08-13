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
});
