import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import './web-utils.js';
import { ProjectScopeProvider, useProjectScope } from '../src/lib/projects.js';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Consumer that reports the scope and lets tests switch projects. */
function ScopeProbe() {
  const { projects, selectedId, selected, select } = useProjectScope();
  const [other, setOther] = useState(false);
  return (
    <div>
      <span data-testid="count">{projects.length}</span>
      <span data-testid="selected-id">{selectedId ?? 'none'}</span>
      <span data-testid="selected-name">{selected?.name ?? 'none'}</span>
      <button type="button" onClick={() => select(2)}>pick2</button>
      <button type="button" onClick={() => select(null)}>clear</button>
      <button type="button" onClick={() => setOther((v) => !v)}>{other ? 'other' : 'idle'}</button>
    </div>
  );
}

const PROJECTS = [
  { id: 1, name: 'Alpha', slug: 'alpha', description: null, serviceCount: 0, databaseCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 2, name: 'Beta', slug: 'beta', description: null, serviceCount: 3, databaseCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

function renderProvider(list: Promise<typeof PROJECTS> | undefined = Promise.resolve(PROJECTS)) {
  const client = makeClient();
  const { ...utils } = render(
    <QueryClientProvider client={client}>
      <ProjectScopeProvider>
        <ScopeProbe />
      </ProjectScopeProvider>
    </QueryClientProvider>,
  );
  void list;
  return utils;
}

// The provider loads the project list through the api client module â€” mock it.
vi.mock('../src/lib/api.js', () => {
  const state = { projects: [...PROJECTS] };
  return {
    api: { projects: { list: vi.fn(async () => state.projects) } },
    __setState: (p: typeof PROJECTS) => { state.projects = p; },
  };
});

describe('ProjectScopeProvider', () => {
  it('defaults to All projects and loads the list', async () => {
    localStorage.removeItem('ninedeploy.projectId');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(screen.getByTestId('selected-id')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-name')).toHaveTextContent('none');
  });

  it('persists the selection and resolves the selected project', async () => {
    localStorage.removeItem('ninedeploy.projectId');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    act(() => { fireEvent.click(screen.getByText('pick2')); });
    expect(screen.getByTestId('selected-id')).toHaveTextContent('2');
    expect(screen.getByTestId('selected-name')).toHaveTextContent('Beta');
    expect(localStorage.getItem('ninedeploy.projectId')).toBe('2');
    act(() => { fireEvent.click(screen.getByText('clear')); });
    expect(localStorage.getItem('ninedeploy.projectId')).toBeNull();
  });

  it('drops a stored selection that no longer exists', async () => {
    localStorage.setItem('ninedeploy.projectId', '99');
    renderProvider(Promise.resolve([PROJECTS[0]!]));
    await waitFor(() => expect(screen.getByTestId('selected-id')).toHaveTextContent('none'));
  });

  it('falls back to an All-projects scope outside the provider', () => {
    render(<ScopeProbe />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.getByTestId('selected-id')).toHaveTextContent('none');
    // The fallback select is a no-op: switching must not throw or change state.
    act(() => { fireEvent.click(screen.getByText('pick2')); });
    expect(screen.getByTestId('selected-id')).toHaveTextContent('none');
  });

  it('survives localStorage access failures', () => {
    const storage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => {},
    } as unknown as Storage;
    Object.defineProperty(window, 'localStorage', { get: () => storage, configurable: true });
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <ProjectScopeProvider>
          <ScopeProbe />
        </ProjectScopeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('selected-id')).toHaveTextContent('none');
    // select() must not blow up when persistence fails.
    act(() => { fireEvent.click(screen.getByText('pick2')); });
    expect(screen.getByTestId('selected-id')).toHaveTextContent('2');
  });
});
