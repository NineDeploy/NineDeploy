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
      passkeys: { loginOptions: vi.fn(), loginVerify: vi.fn() },
    },
  },
  getToken: vi.fn(),
  setSessionTokens: vi.fn(),
  clearTokens: vi.fn(),
}));

const webauthnMock = vi.hoisted(() => ({ startAuthentication: vi.fn() }));

vi.mock('../src/lib/api.js', () => apiMock);
vi.mock('@simplewebauthn/browser', () => webauthnMock);

import { AuthProvider, useAuth } from '../src/lib/auth.js';

const USER: PublicUser = { id: 1, email: 'a@b.c', name: 'Ann', isOperator: true, workspaceCount: 1, createdAt: '2026-01-01T00:00:00Z' };
const SESSION = {
  user: USER,
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 },
};

function Probe() {
  const { user, loading, login, setup, logout, loginWithPasskey } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="email">{user?.email ?? 'none'}</span>
      <button type="button" onClick={() => void login('a@b.c', 'pw')}>login</button>
      <button type="button" onClick={() => void login('a@b.c', 'pw', '123456')}>login-2fa</button>
      <button type="button" onClick={() => void setup('a@b.c', 'pw', 'Ann')}>setup</button>
      <button type="button" onClick={logout}>logout</button>
      <button type="button" onClick={() => void loginWithPasskey().catch(() => undefined)}>login-passkey</button>
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

  it('captures OAuth/OIDC session tokens from the URL hash and clears it', async () => {
    window.location.hash = '#access_token=hash-at&refresh_token=hash-rt';
    try {
      renderAuth();
      await waitFor(() =>
        expect(apiMock.setSessionTokens).toHaveBeenCalledWith('hash-at', 'hash-rt'));
      // The credentials must not linger in the visible URL.
      expect(window.location.hash).toBe('');
    } finally {
      window.location.hash = '';
    }
  });

  it('ignores a hash whose access_token param is present but empty', async () => {
    window.location.hash = '#access_token=';
    try {
      renderAuth();
      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
      expect(apiMock.setSessionTokens).not.toHaveBeenCalled();
    } finally {
      window.location.hash = '';
    }
  });

  it('accepts a hash that carries only an access token', async () => {
    window.location.hash = '#access_token=solo-at';
    try {
      renderAuth();
      await waitFor(() =>
        expect(apiMock.setSessionTokens).toHaveBeenCalledWith('solo-at', undefined));
      expect(window.location.hash).toBe('');
    } finally {
      window.location.hash = '';
    }
  });

  it('ignores a hash without an access token', async () => {
    window.location.hash = '#section';
    try {
      renderAuth();
      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
      expect(apiMock.setSessionTokens).not.toHaveBeenCalled();
    } finally {
      window.location.hash = '';
    }
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
    expect(apiMock.clearTokens).toHaveBeenCalled();
    expect(screen.getByTestId('email')).toHaveTextContent('none');
  });

  it('logs in, stores the access token and sets the user', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('login'));
    expect(apiMock.api.auth.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
    await waitFor(() => expect(apiMock.setSessionTokens).toHaveBeenCalledWith('access-1', 'refresh-1'));
    expect(screen.getByTestId('email')).toHaveTextContent('a@b.c');
  });

  it('logs in with a two-factor code', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('login-2fa'));
    expect(apiMock.api.auth.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw', totpCode: '123456' });
    await waitFor(() => expect(apiMock.setSessionTokens).toHaveBeenCalledWith('access-1', 'refresh-1'));
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
    expect(apiMock.setSessionTokens).not.toHaveBeenCalled();
    expect((captured as ReturnType<typeof useAuth> | null)?.user).toBeNull();
  });

  it('runs the initial setup with name', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('setup'));
    expect(apiMock.api.auth.setup).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw', name: 'Ann' });
    await waitFor(() => expect(apiMock.setSessionTokens).toHaveBeenCalledWith('access-1', 'refresh-1'));
    expect(screen.getByTestId('email')).toHaveTextContent('a@b.c');
  });

  it('signs in with a passkey end to end', async () => {
    apiMock.api.auth.passkeys.loginOptions.mockResolvedValue({ options: JSON.stringify({ challenge: 'abc', rpId: 'nd.local' }) });
    webauthnMock.startAuthentication.mockResolvedValue({ id: 'assertion-1' });
    apiMock.api.auth.passkeys.loginVerify.mockResolvedValue(SESSION);
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('login-passkey'));
    // The browser assertion flow receives the server-generated options…
    expect(apiMock.api.auth.passkeys.loginOptions).toHaveBeenCalled();
    expect(webauthnMock.startAuthentication).toHaveBeenCalledWith({ challenge: 'abc', rpId: 'nd.local' });
    // …and the assertion is verified server-side for a fresh session.
    expect(apiMock.api.auth.passkeys.loginVerify).toHaveBeenCalledWith({ id: 'assertion-1' });
    await waitFor(() => expect(apiMock.setSessionTokens).toHaveBeenCalledWith('access-1', 'refresh-1'));
    expect(screen.getByTestId('email')).toHaveTextContent('a@b.c');
  });

  it('propagates passkey failures without storing tokens', async () => {
    apiMock.api.auth.passkeys.loginOptions.mockResolvedValue({ options: '{}' });
    webauthnMock.startAuthentication.mockResolvedValue({ id: 'a' });
    apiMock.api.auth.passkeys.loginVerify.mockRejectedValue(new Error('bad assertion'));
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByText('login-passkey'));
    await waitFor(() => expect(apiMock.api.auth.passkeys.loginVerify).toHaveBeenCalled());
    expect(apiMock.setSessionTokens).not.toHaveBeenCalled();
    expect(screen.getByTestId('email')).toHaveTextContent('none');
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
    expect(apiMock.clearTokens).toHaveBeenCalled();
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
    expect(apiMock.clearTokens).toHaveBeenCalled();
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
