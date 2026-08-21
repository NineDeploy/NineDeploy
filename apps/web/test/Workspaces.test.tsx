import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Workspaces } from '../src/routes/Workspaces.js';
import { api } from '../src/lib/api.js';
import { useWorkspace } from '../src/lib/workspace.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  // Must be './apiMock.js', not './helpers.js' — see the note in apiMock.ts.
  const { createFakeApiModule } = await import('./apiMock.js');
  return createFakeApiModule();
});

vi.mock('../src/lib/auth.js', async () => {
  const { createAuthMock } = await import('./apiMock.js');
  return createAuthMock();
});

vi.mock('../src/lib/workspace.js', async () => {
  const { createWorkspaceMock } = await import('./apiMock.js');
  return createWorkspaceMock();
});

describe('Workspaces route', () => {
  const mockWs = {
    id: 1,
    name: 'Acme Corp',
    slug: 'acme-corp',
    description: 'Main production workspace',
    myRole: 'owner' as const,
    memberCount: 2,
    projectCount: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    members: [
      { id: 10, userId: 1, role: 'owner' as const, createdAt: '2026-01-01', email: 'admin@acme.com', name: 'Admin' },
      { id: 11, userId: 2, role: 'member' as const, createdAt: '2026-01-01', email: 'dev@acme.com', name: 'Developer' },
    ],
  };

  const switchWorkspace = vi.fn();
  const refreshWorkspaces = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(useWorkspace).mockReturnValue({
      workspaces: [mockWs],
      currentWorkspace: mockWs,
      isLoading: false,
      switchWorkspace,
      createWorkspace: vi.fn(),
      refreshWorkspaces,
    });
    mockOf(api.workspaces.get).mockResolvedValue(mockWs as never);
  });

  it('renders workspace details and member list', async () => {
    renderWithProviders(<Workspaces />);

    await waitFor(() => {
      expect(screen.getByText('Workspaces & Teams')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Main production workspace')).toBeInTheDocument();
      expect(screen.getByText('dev@acme.com')).toBeInTheDocument();
    });
  });

  it('invites a new member to the workspace', async () => {
    mockOf(api.workspaces.addMember).mockResolvedValueOnce({
      id: 12,
      userId: 3,
      role: 'member',
      createdAt: '2026-01-01',
      email: 'newuser@acme.com',
      name: null,
    } as never);

    renderWithProviders(<Workspaces />);

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Invite Member'));
    expect(screen.getByText('Invite Team Member')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('developer@acme.com'), {
      target: { value: 'newuser@acme.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));

    await waitFor(() => {
      expect(api.workspaces.addMember).toHaveBeenCalledWith(1, {
        email: 'newuser@acme.com',
        role: 'member',
      });
      expect(refreshWorkspaces).toHaveBeenCalled();
    });
  });

  it('updates member role', async () => {
    mockOf(api.workspaces.updateMemberRole).mockResolvedValueOnce({
      id: 11,
      userId: 2,
      role: 'admin',
      createdAt: '2026-01-01',
    } as never);

    renderWithProviders(<Workspaces />);

    await waitFor(() => {
      expect(screen.getByText('dev@acme.com')).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    const memberRoleSelect = selects.find((s) => (s as HTMLSelectElement).value === 'member');
    expect(memberRoleSelect).toBeDefined();

    fireEvent.change(memberRoleSelect!, { target: { value: 'admin' } });

    await waitFor(() => {
      expect(api.workspaces.updateMemberRole).toHaveBeenCalledWith(1, 11, {
        role: 'admin',
      });
    });
  });

  it('removes member from workspace', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockOf(api.workspaces.removeMember).mockResolvedValueOnce({ ok: true } as never);

    renderWithProviders(<Workspaces />);

    await waitFor(() => {
      expect(screen.getByText('dev@acme.com')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => {
      expect(api.workspaces.removeMember).toHaveBeenCalledWith(1, 11);
    });
  });

  it('edits workspace details', async () => {
    mockOf(api.workspaces.update).mockResolvedValueOnce({
      ...mockWs,
      name: 'Acme Corp Updated',
      description: 'Updated description',
    } as never);

    renderWithProviders(<Workspaces />);

    await waitFor(() => {
      expect(screen.getByText('Edit Details')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Edit Details'));
    expect(screen.getByText('Edit Workspace')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Acme Corp'), {
      target: { value: 'Acme Corp Updated' },
    });
    fireEvent.change(screen.getByDisplayValue('Main production workspace'), {
      target: { value: 'Updated description' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(api.workspaces.update).toHaveBeenCalledWith(1, {
        name: 'Acme Corp Updated',
        description: 'Updated description',
      });
    });
  });

  it('deletes workspace', async () => {
    mockOf(api.workspaces.delete).mockResolvedValueOnce({ ok: true } as never);

    renderWithProviders(<Workspaces />);

    await waitFor(() => {
      expect(screen.getByText('Delete Workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete Workspace'));
    expect(screen.getByText(/Are you sure you want to permanently delete/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete Workspace' }));

    await waitFor(() => {
      expect(api.workspaces.delete).toHaveBeenCalledWith(1);
      expect(refreshWorkspaces).toHaveBeenCalled();
    });
  });
});
