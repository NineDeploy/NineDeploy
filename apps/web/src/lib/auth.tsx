import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import type { PublicUser } from '@ninedeploy/sdk';
import { api, clearTokens, getToken, setSessionTokens } from './api.js';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  setup: (email: string, password: string, name?: string) => Promise<void>;
  /** Passwordless sign-in with a registered passkey (WebAuthn). */
  loginWithPasskey: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if OAuth / OIDC SSO returned session tokens in the URL hash fragment
    if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const at = params.get('access_token');
      const rt = params.get('refresh_token');
      if (at) {
        setSessionTokens(at, rt ?? undefined);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api.auth
      .me()
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // The API layer fires this when a token refresh is rejected (revoked or
    // expired refresh token). Dropping `user` sends every RequireAuth route
    // back to /login instead of leaving the SPA "logged in" but broken.
    const onSessionExpired = () => setUser(null);
    window.addEventListener('ninedeploy:session-expired', onSessionExpired);
    return () => window.removeEventListener('ninedeploy:session-expired', onSessionExpired);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    login: async (email, password, totpCode) => {
      const session = await api.auth.login(totpCode ? { email, password, totpCode } : { email, password });
      setSessionTokens(session.tokens.accessToken, session.tokens.refreshToken);
      setUser(session.user);
    },
    setup: async (email, password, name) => {
      const session = await api.auth.setup({ email, password, name });
      setSessionTokens(session.tokens.accessToken, session.tokens.refreshToken);
      setUser(session.user);
    },
    loginWithPasskey: async () => {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const { options } = await api.auth.passkeys.loginOptions();
      const assertion = await startAuthentication(JSON.parse(options) as Parameters<typeof startAuthentication>[0]);
      const session = await api.auth.passkeys.loginVerify(assertion);
      setSessionTokens(session.tokens.accessToken, session.tokens.refreshToken);
      setUser(session.user);
    },
    logout: () => {
      // Revoke the session server-side (bumps tokenVersion so outstanding
      // access/refresh tokens die), then clear the local state. Best-effort:
      // local cleanup must happen even if the API call fails (e.g. offline).
      void api.auth.logout().catch(() => undefined);
      clearTokens();
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
