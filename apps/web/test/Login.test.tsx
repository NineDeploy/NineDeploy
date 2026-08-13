import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { Login } from '../src/routes/Login.js';
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

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function authValue(overrides: Record<string, unknown> = {}) {
  return {
    user: null,
    loading: false,
    login: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    ...overrides,
  };
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to / when already logged in', async () => {
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    mockOf(useAuth).mockReturnValue(authValue({ user: { id: 1, email: 'a@b.c' } }) as never);
    renderWithProviders(
      <>
        <Login />
        <LocationProbe />
      </>,
    );
    await screen.findByTestId('location');
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('shows the sign-in form for an initialized instance', async () => {
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    mockOf(useAuth).mockReturnValue(authValue() as never);
    renderWithProviders(<Login />);
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByPlaceholderText('Admin')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
  });

  it('logs in and navigates to the from location', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    mockOf(useAuth).mockReturnValue(authValue({ login }) as never);
    renderWithProviders(
      <>
        <Login />
        <LocationProbe />
      </>,
      { initialEntries: [{ pathname: '/login', state: { from: '/hub' } }] },
    );
    await user.type(await screen.findByPlaceholderText('you@example.com'), 'a@b.c');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('a@b.c', 'secret'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hub'));
  });

  it('defaults navigation to / when no from state', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    mockOf(useAuth).mockReturnValue(authValue({ login }) as never);
    renderWithProviders(
      <>
        <Login />
        <LocationProbe />
      </>,
    );
    await user.type(await screen.findByPlaceholderText('you@example.com'), 'a@b.c');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'));
  });

  it('shows the setup form for a fresh instance and creates the admin', async () => {
    const user = userEvent.setup();
    const setup = vi.fn().mockResolvedValue(undefined);
    mockOf(api.auth.status).mockResolvedValue({ initialized: false } as never);
    mockOf(useAuth).mockReturnValue(authValue({ setup }) as never);
    renderWithProviders(<Login />);
    await screen.findByRole('heading', { name: 'Create admin account' });
    expect(screen.getByPlaceholderText('Admin')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Admin'), 'Boss');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.c');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret');
    await user.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => expect(setup).toHaveBeenCalledWith('a@b.c', 'secret', 'Boss'));
  });

  it('creates the admin without a display name', async () => {
    const user = userEvent.setup();
    const setup = vi.fn().mockResolvedValue(undefined);
    mockOf(api.auth.status).mockResolvedValue({ initialized: false } as never);
    mockOf(useAuth).mockReturnValue(authValue({ setup }) as never);
    renderWithProviders(<Login />);
    await screen.findByRole('heading', { name: 'Create admin account' });
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.c');
    await user.type(screen.getByPlaceholderText('••••••••'), 'secret');
    await user.click(screen.getByRole('button', { name: /Create account/ }));
    await waitFor(() => expect(setup).toHaveBeenCalledWith('a@b.c', 'secret', undefined));
  });

  it('shows an error message when login fails', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new Error('Bad credentials'));
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    mockOf(useAuth).mockReturnValue(authValue({ login }) as never);
    renderWithProviders(<Login />);
    await user.type(await screen.findByPlaceholderText('you@example.com'), 'a@b.c');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrong');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    await screen.findByText('Bad credentials');
  });

  it('shows a generic error when a non-Error is thrown', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue('boom');
    mockOf(api.auth.status).mockResolvedValue({ initialized: true } as never);
    mockOf(useAuth).mockReturnValue(authValue({ login }) as never);
    renderWithProviders(<Login />);
    await user.type(await screen.findByPlaceholderText('you@example.com'), 'a@b.c');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrong');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    await screen.findByText('Something went wrong');
  });
});
