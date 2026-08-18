import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceProvider, useWorkspace } from '../src/lib/workspace.js';
import { api } from '../src/lib/api.js';
import { mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const fakeUser = { id: 1, email: 'admin@example.com', role: 'admin' as const, name: 'Admin', createdAt: '2026-01-01' };
vi.mock('../src/lib/auth.js', () => ({
  useAuth: () => ({ user: fakeUser }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </QueryClientProvider>
  );
}

describe('WorkspaceContext and WorkspaceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('throws error when useWorkspace is used outside WorkspaceProvider', () => {
    expect(() => renderHook(() => useWorkspace())).toThrow('useWorkspace must be used within WorkspaceProvider');
  });

  it('loads workspaces and sets initial workspace', async () => {
    const mockWorkspaces = [
      { id: 1, name: 'Workspace One', slug: 'ws-1', ownerId: 1, myRole: 'owner' as const, memberCount: 1, projectCount: 2, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 2, name: 'Workspace Two', slug: 'ws-2', ownerId: 2, myRole: 'member' as const, memberCount: 3, projectCount: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];
    mockOf(api.workspaces.list).mockResolvedValueOnce(mockWorkspaces as never);

    const { result } = renderHook(() => useWorkspace(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(2);
      expect(result.current.currentWorkspace?.id).toBe(1);
    });

    // Switch workspace
    act(() => {
      result.current.switchWorkspace(2);
    });

    expect(result.current.currentWorkspace?.id).toBe(2);
    expect(localStorage.getItem('nd_current_workspace_id')).toBe('2');
  });

  it('creates workspace and switches to it', async () => {
    const mockWorkspaces = [
      { id: 1, name: 'Personal', slug: 'personal', ownerId: 1, myRole: 'owner' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];
    const createdWs = {
      id: 5,
      name: 'Team WS',
      slug: 'team-ws',
      ownerId: 1,
      myRole: 'owner' as const,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };

    mockOf(api.workspaces.list).mockResolvedValueOnce(mockWorkspaces as never);
    mockOf(api.workspaces.create).mockResolvedValueOnce(createdWs as never);

    const { result } = renderHook(() => useWorkspace(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(1);
    });

    let res: any;
    await act(async () => {
      res = await result.current.createWorkspace({ name: 'Team WS' });
    });

    expect(res.id).toBe(5);
    expect(api.workspaces.create).toHaveBeenCalledWith({ name: 'Team WS' });
  });

  it('refreshes workspaces list', async () => {
    mockOf(api.workspaces.list).mockResolvedValue([] as never);
    const { result } = renderHook(() => useWorkspace(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.refreshWorkspaces();
    });

    expect(api.workspaces.list).toHaveBeenCalled();
  });
});
