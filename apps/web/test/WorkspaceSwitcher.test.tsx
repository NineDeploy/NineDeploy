import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher.js';
import { useWorkspace } from '../src/lib/workspace.js';

vi.mock('../src/lib/workspace.js', () => ({
  useWorkspace: vi.fn(),
}));

describe('WorkspaceSwitcher', () => {
  const switchWorkspace = vi.fn();
  const createWorkspace = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when no workspaces exist', () => {
    vi.mocked(useWorkspace).mockReturnValue({
      workspaces: [],
      currentWorkspace: null,
      isLoading: false,
      switchWorkspace,
      createWorkspace,
      refreshWorkspaces: vi.fn(),
    });

    const { container } = render(<WorkspaceSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders active workspace button and toggles dropdown', async () => {
    const ws1 = { id: 1, name: 'Acme Prod', slug: 'acme-prod', description: null, ownerId: 1, myRole: 'owner' as const, memberCount: 2, projectCount: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    const ws2 = { id: 2, name: 'Dev Space', slug: 'dev-space', description: null, ownerId: 2, myRole: 'member' as const, memberCount: 1, projectCount: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' };

    vi.mocked(useWorkspace).mockReturnValue({
      workspaces: [ws1, ws2],
      currentWorkspace: ws1,
      isLoading: false,
      switchWorkspace,
      createWorkspace,
      refreshWorkspaces: vi.fn(),
    });

    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>,
    );

    expect(screen.getByText('Acme Prod')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();

    // Open dropdown
    fireEvent.click(screen.getByText('Acme Prod'));

    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Dev Space')).toBeInTheDocument();

    // The backdrop (aria-label) closes the menu without switching.
    fireEvent.click(screen.getByLabelText('Close workspace menu'));
    expect(screen.queryByText('Dev Space')).not.toBeInTheDocument();

    // Reopen and switch to ws2.
    fireEvent.click(screen.getByText('Acme Prod'));
    fireEvent.click(screen.getByText('Dev Space'));
    expect(switchWorkspace).toHaveBeenCalledWith(2);

    // The manage link points at the workspaces page and closes the menu.
    fireEvent.click(screen.getByText('Acme Prod'));
    const manage = screen.getByText('Manage Workspace & Team').closest('a');
    expect(manage).toHaveAttribute('href', '/workspaces');
    fireEvent.click(screen.getByText('Manage Workspace & Team'));
    expect(screen.queryByText('Manage Workspace & Team')).not.toBeInTheDocument();
  });

  it('opens create workspace modal and creates workspace', async () => {
    const ws1 = { id: 1, name: 'Acme Prod', slug: 'acme-prod', description: null, ownerId: 1, myRole: 'owner' as const, memberCount: 2, projectCount: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    createWorkspace.mockResolvedValueOnce({ id: 3, name: 'New Team', slug: 'new-team' });

    vi.mocked(useWorkspace).mockReturnValue({
      workspaces: [ws1],
      currentWorkspace: ws1,
      isLoading: false,
      switchWorkspace,
      createWorkspace,
      refreshWorkspaces: vi.fn(),
    });

    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Acme Prod'));
    fireEvent.click(screen.getByText('Create Workspace'));

    expect(screen.getByText('Create New Workspace')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Production'), { target: { value: 'New Team' } });
    fireEvent.change(screen.getByPlaceholderText('Workspace for production workloads and team members.'), {
      target: { value: 'Production workspace' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith({
        name: 'New Team',
        description: 'Production workspace',
      });
    });
  });

  it('cancels the create modal and surfaces creation failures', async () => {
    const ws1 = { id: 1, name: 'Acme Prod', slug: 'acme-prod', description: null, ownerId: 1, myRole: 'owner' as const, memberCount: 2, projectCount: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };

    vi.mocked(useWorkspace).mockReturnValue({
      workspaces: [ws1],
      currentWorkspace: ws1,
      isLoading: false,
      switchWorkspace,
      createWorkspace,
      refreshWorkspaces: vi.fn(),
    });

    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>,
    );

    // Cancel discards the draft.
    fireEvent.click(screen.getByText('Acme Prod'));
    fireEvent.click(screen.getByText('Create Workspace'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Create New Workspace')).not.toBeInTheDocument());
    expect(createWorkspace).not.toHaveBeenCalled();

    // A rejected creation surfaces the server message in the form.
    createWorkspace.mockRejectedValueOnce(new Error('slug taken') as never);
    fireEvent.click(screen.getByText('Acme Prod'));
    fireEvent.click(screen.getByText('Create Workspace'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Acme Production'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
    expect(await screen.findByText('slug taken')).toBeInTheDocument();
  });
});
