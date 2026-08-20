import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './web-utils.js';

const authMock = vi.hoisted(() => ({ useAuth: vi.fn() }));
const themeMock = vi.hoisted(() => ({ useTheme: vi.fn() }));
const workspaceMock = vi.hoisted(() => ({
  useWorkspace: vi.fn(() => ({
    workspaces: [],
    currentWorkspace: null,
    isLoading: false,
    switchWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
  })),
}));
const apiMock = vi.hoisted(() => ({
  getToken: vi.fn(() => 'tok'),
  api: {
    services: { list: vi.fn() },
    databases: { list: vi.fn() },
    templates: { list: vi.fn() },
    projects: { list: vi.fn() },
    plugins: { list: vi.fn() },
    menus: { list: vi.fn() },
  },
}));

vi.mock('../src/lib/auth.js', () => ({ useAuth: authMock.useAuth }));
vi.mock('../src/lib/theme.js', () => ({ useTheme: themeMock.useTheme }));
vi.mock('../src/lib/workspace.js', () => ({ useWorkspace: workspaceMock.useWorkspace }));
vi.mock('../src/lib/api.js', () => apiMock);

import { Layout } from '../src/components/Layout.js';
import { ProjectScopeProvider } from '../src/lib/projects.js';

function renderLayout(path = '/databases') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ProjectScopeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<div data-testid="outlet">page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
      </ProjectScopeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.useAuth.mockReturnValue({
      user: { id: 1, email: 'ada@example.com', name: 'Ada', role: 'admin' },
      logout: vi.fn(),
      loading: false,
    });
    themeMock.useTheme.mockReturnValue({
      theme: 'dark',
      accent: 'indigo',
      setTheme: vi.fn(),
      setAccent: vi.fn(),
      toggleTheme: vi.fn(),
    });
    apiMock.getToken.mockReturnValue('tok');
    apiMock.api.services.list.mockResolvedValue([]);
    apiMock.api.databases.list.mockResolvedValue([]);
    apiMock.api.templates.list.mockResolvedValue([]);
    apiMock.api.projects.list.mockResolvedValue([]);
    apiMock.api.plugins.list.mockResolvedValue({ plugins: [] });
    apiMock.api.menus.list.mockResolvedValue({ items: [] });
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the activity bar, groups and the user avatar', () => {
    renderLayout();
    // brand mark is the SVG logo now (aria-hidden) — assert the rail renders it
    expect(document.querySelector('.flex.w-12 svg')).toBeInTheDocument();
    for (const g of ['Deploy', 'Data', 'Network', 'System']) {
      expect(screen.getAllByText(g).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('A')).toBeInTheDocument(); // avatar initial
    expect(screen.getByText('ada@example.com · Sign out')).toBeInTheDocument();
  });

  it('opens the group panel and marks the matching link active', () => {
    renderLayout('/databases');
    expect(screen.getAllByText('Data').length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: /Databases/ });
    expect(link.className).toContain('bg-indigo-500/15');
    expect(screen.getByText('/')).toBeInTheDocument(); // breadcrumb separator
  });

  it('falls back to the NineDeploy header without a panel for unknown paths', () => {
    renderLayout('/nowhere');
    expect(screen.getByText('NineDeploy')).toBeInTheDocument();
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();
  });

  it('marks the Services link active on /services', () => {
    renderLayout('/services');
    const link = screen.getByRole('link', { name: /Services/ });
    expect(link.className).toContain('bg-indigo-500/15');
  });

  it('does not mark Services active when another Deploy item is active', () => {
    renderLayout('/dashboard');
    const services = screen.getByRole('link', { name: /Services/ });
    expect(services.className).not.toContain('bg-indigo-500/15');
    const dashboard = screen.getByRole('link', { name: /Dashboard/ });
    expect(dashboard.className).toContain('bg-indigo-500/15');
  });

  it('toggles groups from the activity bar', async () => {
    const user = userEvent.setup();
    renderLayout('/databases');
    expect(screen.getByText('Collapse')).toBeInTheDocument();
    // close the "data" group via its icon button
    const buttons = screen.getAllByRole('button');
    const dataBtn = buttons.find((b) => b.textContent === 'Data') as HTMLButtonElement;
    await user.click(dataBtn);
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();
    await user.click(dataBtn);
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  it('collapses the panel via the collapse button', async () => {
    const user = userEvent.setup();
    renderLayout('/databases');
    await user.click(screen.getByText('Collapse'));
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();
    expect(screen.getByText('NineDeploy')).toBeInTheDocument();
  });

  it('updates the active group on navigation', async () => {
    const user = userEvent.setup();
    renderLayout('/databases');
    expect(screen.getAllByText('Data').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('link', { name: /Volumes/ }));
    expect(screen.getAllByText('Data').length).toBeGreaterThan(0);
    // Switch to the Deploy group via the activity bar, then click Hub.
    const deployBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent === 'Deploy') as HTMLButtonElement;
    await user.click(deployBtn);
    await user.click(screen.getByRole('link', { name: /Hub/ }));
    expect(screen.getAllByText('Deploy').length).toBeGreaterThan(0);
  });

  it('toggles the theme from the header', async () => {
    const toggleTheme = vi.fn();
    themeMock.useTheme.mockReturnValue({
      theme: 'dark',
      accent: 'indigo',
      setTheme: vi.fn(),
      setAccent: vi.fn(),
      toggleTheme,
    });
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Light mode'));
    expect(toggleTheme).toHaveBeenCalled();
  });

  it('shows the moon icon when the theme is light', () => {
    themeMock.useTheme.mockReturnValue({
      theme: 'light',
      accent: 'indigo',
      setTheme: vi.fn(),
      setAccent: vi.fn(),
      toggleTheme: vi.fn(),
    });
    renderLayout();
    expect(screen.getByTitle('Dark mode')).toBeInTheDocument();
  });

  it('opens the command palette with the search button and closes it', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Search (⌘K)'));
    expect(screen.getByPlaceholderText(/Search services/)).toBeInTheDocument();
    await user.click(screen.getByText('Hub'));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Search services/)).not.toBeInTheDocument(),
    );
  });

  it('toggles the command palette with Cmd+K / Ctrl+K', async () => {
    renderLayout();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText(/Search services/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText(/Search services/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'x', metaKey: true });
    expect(screen.queryByPlaceholderText(/Search services/)).not.toBeInTheDocument();
  });

  it('renders the activity drawer with live events from the socket', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Activity'));
    expect(screen.getByText('Events')).toBeInTheDocument();
    const ws = FakeWebSocket.instances[0];
    expect(ws?.url).toBe('ws://localhost/v1/events');
    expect(ws?.protocols).toEqual(['ninedeploy.bearer.tok']);

    const now = Date.now();
    const payload = [
      JSON.stringify({ id: 1, action: 'deploy.start', entity: 'api', ts: new Date(now - 1000).toISOString() }),
      JSON.stringify({ id: 2, action: 'database.delete', entity: 'pg', ts: new Date(now - 5 * 60000).toISOString() }),
      JSON.stringify({ id: 3, action: 'weird.thing', entity: null, ts: new Date(now - 2 * 3600000).toISOString() }),
    ].join('\n');
    actSocket(ws, payload);

    expect(screen.getByText('deploy start')).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.getByText('database delete')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('weird thing')).toBeInTheDocument();
  });

  it('connects the events socket with an empty token when none is stored', async () => {
    apiMock.getToken.mockReturnValue(null);
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Activity'));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://localhost/v1/events');
  });

  it('uses wss when the page is served over https', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: new URL('https://example.com/databases'),
      configurable: true,
    });
    try {
      const user = userEvent.setup();
      renderLayout();
      await user.click(screen.getByTitle('Activity'));
      expect(FakeWebSocket.instances[0]?.url).toBe('wss://example.com/v1/events');
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true });
    }
  });

  it('omits the token when none is stored', async () => {
    apiMock.getToken.mockReturnValueOnce(undefined);
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Activity'));
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://localhost/v1/events');
  });

  it('ignores malformed socket payloads', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Activity'));
    const ws = FakeWebSocket.instances[0];
    actSocket(ws, 'not-json\nalso-not-json');
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });

  it('filters drawer events by action prefix', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Activity'));
    const ws = FakeWebSocket.instances[0];
    const now = new Date().toISOString();
    actSocket(ws, [JSON.stringify({ id: 1, action: 'deploy.start', entity: null, ts: now }), JSON.stringify({ id: 2, action: 'database.create', entity: null, ts: now })].join('\n'));

    await user.click(screen.getByRole('button', { name: 'deploy' }));
    expect(screen.getByText('deploy start')).toBeInTheDocument();
    expect(screen.queryByText('database create')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'all' }));
    expect(screen.getByText('database create')).toBeInTheDocument();
  });

  it('closes the drawer via the X button and the backdrop', async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    await user.click(screen.getByTitle('Activity'));
    expect(screen.getByText('Events')).toBeInTheDocument();
    // The drawer's header close button has a distinctive class signature
    // ("rounded-lg p-1 text-slate-500 ...") unique to it.
    const drawerClose = container.querySelector(
      'button.rounded-lg.p-1.text-slate-500',
    ) as HTMLButtonElement;
    expect(drawerClose).not.toBeNull();
    await user.click(drawerClose);
    expect(screen.queryByText('Events')).not.toBeInTheDocument();

    // Backdrop close: the backdrop sits inside the drawer's `.fixed`
    // wrapper as the first child (`absolute inset-0 bg-black/40`).
    await user.click(screen.getByTitle('Activity'));
    expect(screen.getByText('View Full Audit Ledger')).toBeInTheDocument();
    const backdrop = container.querySelector('div.fixed > button.absolute') as HTMLElement;
    await user.click(backdrop);
    expect(screen.queryByText('Events')).not.toBeInTheDocument();

    // Clicking View Full Audit Ledger navigates and closes drawer
    await user.click(screen.getByTitle('Activity'));
    const ledgerLink = screen.getByRole('link', { name: /View Full Audit Ledger/i });
    await user.click(ledgerLink);
    expect(screen.queryByText('Events')).not.toBeInTheDocument();
  });

  it('logs out from the avatar button', async () => {
    const logout = vi.fn();
    authMock.useAuth.mockReturnValue({ user: { id: 1, email: 'a@b.c', name: null, role: 'admin' }, logout, loading: false });
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByTitle('Sign out'));
    expect(logout).toHaveBeenCalled();
  });

  it('shows a question mark avatar when there is no user', () => {
    authMock.useAuth.mockReturnValue({ user: null, logout: vi.fn(), loading: false });
    renderLayout();
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders the outlet content', () => {
    renderLayout();
    expect(screen.getByTestId('outlet')).toHaveTextContent('page');
  });

  it('shows the global project switcher and scopes on change', async () => {
    localStorage.removeItem('ninedeploy.projectId');
    apiMock.api.projects.list.mockResolvedValue([
      { id: 3, name: 'Acme', slug: 'acme', description: null, serviceCount: 1, databaseCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    renderLayout();
    const select = await screen.findByLabelText('Project scope');
    expect(select).toHaveValue('');
    const acme = await screen.findByRole('option', { name: 'Acme' });
    expect(acme).toHaveValue('3');
    await act(async () => { fireEvent.change(select, { target: { value: '3' } }); });
    expect(localStorage.getItem('ninedeploy.projectId')).toBe('3');
    // Switching back to All clears the stored scope.
    await act(async () => { fireEvent.change(select, { target: { value: '' } }); });
    expect(localStorage.getItem('ninedeploy.projectId')).toBeNull();
    localStorage.removeItem('ninedeploy.projectId');
  });

  it('colors delete and create actions with their dedicated tones', async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    await user.click(screen.getByTitle('Activity'));
    const ws = FakeWebSocket.instances[0];
    const now = new Date().toISOString();
    actSocket(
      ws,
      [
        JSON.stringify({ id: 1, action: 'service.delete', entity: null, ts: now }),
        JSON.stringify({ id: 2, action: 'service.create', entity: null, ts: now }),
        JSON.stringify({ id: 3, action: 'unicorn.prance', entity: null, ts: now }),
      ].join('\n'),
    );
    // Each row renders its action label with the matching tone class:
    // rose for delete, emerald for create, slate as the fallback.
    await waitFor(() => {
      expect(container.querySelector('.text-rose-300')).not.toBeNull();
      expect(container.querySelector('.text-emerald-300')).not.toBeNull();
      expect(container.querySelector('.text-slate-300')).not.toBeNull();
    });
  });

  it('renders dynamic extension items registered by plugins with custom and fallback icons', async () => {
    apiMock.api.menus.list.mockResolvedValue({
      items: [
        { id: 'datadog-dash', label: 'Datadog APM', route: '/datadog', icon: 'activity' },
        { id: 'custom-tool', label: 'Custom Tool', route: '/custom', icon: 'unknown_icon' },
      ],
    });

    renderLayout('/databases');
    await waitFor(() => {
      expect(screen.getAllByText('Extensions').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Extensions' }));
    expect(await screen.findByText('Datadog APM')).toBeInTheDocument();
    expect(screen.getByText('Custom Tool')).toBeInTheDocument();
  });

  it('gracefully falls back when menus query rejects', async () => {
    apiMock.api.menus.list.mockRejectedValue(new Error('menus unavailable'));
    renderLayout('/databases');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Databases/ })).toBeInTheDocument();
    });
  });
});

/** Simulate the socket receiving a payload and flush React updates. */
function actSocket(ws: FakeWebSocket | undefined, data: string): void {
  act(() => ws?.message(data));
}
