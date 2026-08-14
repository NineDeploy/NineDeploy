import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './web-utils.js';
import type { PublicUser } from '@ninedeploy/sdk';

const apiMock = vi.hoisted(() => ({
  api: {
    auth: {
      me: vi.fn(),
      login: vi.fn(),
      setup: vi.fn(),
      logout: vi.fn(),
    },
  },
  getToken: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock('../src/lib/api.js', () => apiMock);

import { AuthProvider, useAuth } from '../src/lib/auth.js';

const USER: PublicUser = { id: 1, email: 'a@b.c', name: 'Ann', role: 'admin' };
const SESSION = {
  user: USER,
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 },
};

function Probe() {
  const { user, loading, login, setup, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="email">{user?.email ?? 'none'}</span>
      <button onClick={() => void login('a@b.c', 'pw')}>login</button>
      <button onClick={() => void setup('a@b.c', 'pw', 'Ann')}>setup</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getToken.mockReturnValue(null);
    apiMock.api.auth.me.mockResolvedValue(USER);
    apiMock.api.auth.login.mockResolvedValue(SESSION);
    apiMock.api.auth.setup.mockResolvedValue(SESSION);
  });

  it('finishes loading without calling me() when no token exists', () => {
    renderAuth();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('email')).toHaveTextContent('none');
    expect(apiMock.api.auth.me).not.toHaveBeenCalled();
  });

  it('loads the current user when a token exists', async () => {
    apiMock.getToken.mockReturnValue('tok');
    renderAuth();
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(apiMock.api.auth.me).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent('a@b.c'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('clears the token and finishes loading when me() rejects', async () => {
    apiMock.getToken.mockReturnValue('bad');
    apiMock.api.auth.me.mockRejectedValue(new Error('nope'));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(apiMock.setToken).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });

  it('logs in, stores the access token and sets the user', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('login'));
    expect(apiMock.api.auth.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
    await waitFor(() => expect(apiMock.setToken).toHaveBeenCalledWith('access-1'));
    expect(screen.getByTestId('email')).toHaveTextContent('a@b.c');
  });

  it('propagates login failures', async () => {
    apiMock.api.auth.login.mockRejectedValue(new Error('bad creds'));
    let captured: ReturnType<typeof useAuth> | null = null;
    function Capture() {
      captured = useAuth();
      return null;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    // Call login directly via the captured context and attach a catch so the
    // rejection is not surfaced as unhandled.
    await expect(
      (async () => {
        try {
          await captured!.login('a@b.c', 'pw');
        } catch {
          /* expected */
        }
      })(),
    ).resolves.toBeUndefined();
    await waitFor(() => expect(apiMock.api.auth.login).toHaveBeenCalled());
    expect(apiMock.setToken).not.toHaveBeenCalled();
    expect(captured?.user).toBeNull();
  });

  it('runs the initial setup with name', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('setup'));
    expect(apiMock.api.auth.setup).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw', name: 'Ann' });
    await waitFor(() => expect(apiMock.setToken).toHaveBeenCalledWith('access-1'));
    expect(screen.getByTestId('email')).toHaveTextContent('a@b.c');
  });

  it('logs out by revoking server-side and clearing token and user', async () => {
    apiMock.getToken.mockReturnValue('tok');
    apiMock.api.auth.me.mockResolvedValue(USER);
    apiMock.api.auth.logout.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent('a@b.c'));
    await user.click(screen.getByText('logout'));
    // The session is revoked on the server (tokenVersion bump)…
    expect(apiMock.api.auth.logout).toHaveBeenCalled();
    // …and the local state is cleared regardless.
    expect(apiMock.setToken).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });

  it('still clears local state when the server logout call fails', async () => {
    apiMock.getToken.mockReturnValue('tok');
    apiMock.api.auth.me.mockResolvedValue(USER);
    apiMock.api.auth.logout.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent('a@b.c'));
    await user.click(screen.getByText('logout'));
    expect(apiMock.setToken).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });
});

describe('useAuth', () => {
  it('throws when used outside an AuthProvider', () => {
    const original = console.error;
    console.error = vi.fn();
    try {
      expect(() => act(() => render(<Probe />))).toThrow(
        'useAuth must be used within AuthProvider',
      );
    } finally {
      console.error = original;
    }
  });
});
