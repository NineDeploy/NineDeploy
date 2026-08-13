import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import App from '../src/App.js';
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

// Layout is covered by the components worker — render a thin shell here.
vi.mock('../src/components/Layout.js', async () => {
  const { Outlet } = await import('react-router');
  const Layout = () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  );
  return { Layout };
});

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function authState(user: unknown, loading = false) {
  mockOf(useAuth).mockReturnValue({
    user,
    loading,
    login: vi.fn(),
    setup: vi.fn(),
    logout: vi.fn(),
  } as never);
}

const emptyDash = {
  stats: { services: 0, databases: 0, deployments: 0, domains: 0, webhooks: 0, running: 0, stopped: 0, errored: 0, dbRunning: 0, containers: 0 },
  health: [],
  recentDeploys: [],
};

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a full-screen spinner while auth is loading', () => {
    authState(null, true);
    renderWithProviders(<App />, { route: '/' });
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('redirects unauthenticated users to /login with the from path', async () => {
    authState(null);
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/databases' },
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });

  it('redirects unknown paths to /', async () => {
    authState({ id: 1, email: 'a@b.c' });
    mockOf(api.dashboard.get).mockResolvedValue(emptyDash as never);
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/does-not-exist' },
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'));
  });

  it('renders the authenticated shell and the index route', async () => {
    authState({ id: 1, email: 'a@b.c' });
    mockOf(api.dashboard.get).mockResolvedValue(emptyDash as never);
    renderWithProviders(<App />, { route: '/' });
    await screen.findByTestId('layout');
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  });

  it('renders a nested route inside the authenticated shell', async () => {
    authState({ id: 1, email: 'a@b.c' });
    mockOf(api.templates.list).mockResolvedValue([] as never);
    renderWithProviders(<App />, { route: '/hub' });
    await screen.findByTestId('layout');
    expect(await screen.findByText('Hub')).toBeInTheDocument();
  });

  it('renders the login route for unauthenticated users', async () => {
    authState(null);
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    renderWithProviders(<App />, { route: '/login' });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
});
