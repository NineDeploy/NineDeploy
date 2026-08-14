import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import type { PublicUser } from '@ninedeploy/sdk';
import { api, getToken, setToken } from './api.js';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api.auth
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    login: async (email, password) => {
      const session = await api.auth.login({ email, password });
      setToken(session.tokens.accessToken);
      setUser(session.user);
    },
    setup: async (email, password, name) => {
      const session = await api.auth.setup({ email, password, name });
      setToken(session.tokens.accessToken);
      setUser(session.user);
    },
    logout: () => {
      // Revoke the session server-side (bumps tokenVersion so outstanding
      // access/refresh tokens die), then clear the local state. Best-effort:
      // local cleanup must happen even if the API call fails (e.g. offline).
      void api.auth.logout().catch(() => undefined);
      setToken(null);
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
