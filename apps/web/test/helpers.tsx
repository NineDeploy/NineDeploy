import { afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { ToastProvider } from '../src/components/Toast.js';
import { ProjectScopeProvider } from '../src/lib/projects.js';
import { WorkspaceProvider } from '../src/lib/workspace.js';

/** jsdom does not implement ResizeObserver — some rendered components touch it. */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Build the fake module shape consumed by `src/lib/api.ts` consumers:
 * an `api` client where every method is a controllable `vi.fn()` plus the
 * token helpers routes import. Returned object mirrors the module exports.
 */
export function createFakeApiModule() {
  const api = {
    auth: {
      status: vi.fn(),
      setup: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      forgotPassword: vi.fn(),
      resetPasswordWithToken: vi.fn(),
      twoFactor: { setup: vi.fn(), enable: vi.fn(), disable: vi.fn() },
      passkeys: {
        list: vi.fn(),
        registerOptions: vi.fn(),
        registerVerify: vi.fn(),
        remove: vi.fn(),
        loginOptions: vi.fn(),
        loginVerify: vi.fn(),
      },
      sessions: { list: vi.fn(), revoke: vi.fn() },
      me: vi.fn(),
      tokens: { create: vi.fn(), list: vi.fn(), remove: vi.fn() },
      oidc: {
        list: vi.fn(),
        publicProviders: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
    workspaces: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      addMember: vi.fn(),
      updateMemberRole: vi.fn(),
      removeMember: vi.fn(),
    },
    services: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
      restart: vi.fn(),
      logs: vi.fn(),
      exportUrl: vi.fn(),
      importBundle: vi.fn(),
    },
    deploys: { trigger: vi.fn(), list: vi.fn(), rollback: vi.fn(), cancel: vi.fn(), configDiff: vi.fn() },
    domains: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), all: vi.fn(), setSsl: vi.fn(), update: vi.fn() },
    volumes: { list: vi.fn(), remove: vi.fn(), prune: vi.fn(), listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), deleteFile: vi.fn() },
    containers: { inspect: vi.fn(), compose: vi.fn(), listFiles: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), deleteFile: vi.fn() },
    system: { resources: vi.fn(), pruneImages: vi.fn(), exportUrl: vi.fn(), updateCheck: vi.fn(), dockerEvents: vi.fn() },
    networks: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), attach: vi.fn(), detach: vi.fn() },
    tunnels: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    activity: { list: vi.fn() },
    alerts: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    users: { list: vi.fn(), create: vi.fn(), setRole: vi.fn(), remove: vi.fn(), resetPassword: vi.fn(), resetLink: vi.fn() },
    settings: {
      get: vi.fn(),
      setAllowRegistration: vi.fn(),
      setAcmeEmail: vi.fn(),
      setPanelDomain: vi.fn(),
      setTemplatesSource: vi.fn(),
      setDns: vi.fn(),
      dnsRecords: { get: vi.fn(), set: vi.fn(), test: vi.fn() },
      vault: { get: vi.fn(), set: vi.fn(), test: vi.fn() },
    },
    about: { get: vi.fn() },
    notifications: {
      listChannels: vi.fn(),
      createChannel: vi.fn(),
      updateChannel: vi.fn(),
      removeChannel: vi.fn(),
      testChannel: vi.fn(),
      log: vi.fn(),
    },
    sources: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    projects: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    webhooks: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    databases: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
      logs: vi.fn(),
      credentials: vi.fn(),
      setLimits: vi.fn(),
      startStudio: vi.fn(),
      stopStudio: vi.fn(),
    },
    attachments: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    env: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    stats: { snapshot: vi.fn(), metrics: vi.fn() },
    dashboard: { get: vi.fn() },
    topology: { get: vi.fn() },
    templates: { list: vi.fn(), get: vi.fn(), deploy: vi.fn() },
    backups: {
      storage: vi.fn(),
      backupNow: vi.fn(),
      listForDb: vi.fn(),
      restore: vi.fn(),
      list: vi.fn(),
      remove: vi.fn(),
      downloadUrl: vi.fn(),
    },
    limits: { setService: vi.fn(), setDatabase: vi.fn() },
    backupDestinations: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn() },
    jobs: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), run: vi.fn(), runs: vi.fn() },
    servers: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      remove: vi.fn(),
      test: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      sshTest: vi.fn(),
      sshBootstrap: vi.fn(),
      bootstrapLogs: vi.fn(),
    },
    traefik: { get: vi.fn(), status: vi.fn(), certificates: vi.fn(), logs: vi.fn(), restart: vi.fn(), backupCerts: vi.fn() },
    config: { list: vi.fn(), get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    plugins: { list: vi.fn(), marketplace: vi.fn(), install: vi.fn(), enable: vi.fn(), disable: vi.fn(), reload: vi.fn(), inspect: vi.fn(), uninstall: vi.fn() },
    menus: { list: vi.fn() },
    logDrains: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      test: vi.fn(),
    },
    housekeeping: {
      getAutoPrune: vi.fn(),
      updateAutoPrune: vi.fn(),
      runPrune: vi.fn(),
    },
    demo: { seed: vi.fn() },
    health: vi.fn(),
  };
  const getToken = vi.fn(() => 'test-token');
  return {
    api,
    getToken,
    setToken: vi.fn(),
    setSessionTokens: vi.fn(),
    clearTokens: vi.fn(),
    deployLogsWsUrl: vi.fn(() => 'ws://localhost/v1/logs'),
    // Mirrors the real authedFetch: bearer header from getToken + plain fetch.
    authedFetch: (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    },
  };
}

/** Mock module for `src/lib/auth.js`: `useAuth` is a controllable spy. */
export function createAuthMock() {
  return {
    AuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useAuth: vi.fn(),
  };
}

/** Mock module for `src/lib/theme.js`. */
export function createThemeMock() {
  const theme = {
    theme: 'dark' as const,
    accent: 'phosphor' as const,
    setTheme: vi.fn(),
    setAccent: vi.fn(),
    toggleTheme: vi.fn(),
  };
  const ACCENTS = [
    { id: 'phosphor', label: 'Phosphor', color: '#4ecdc4' },
    { id: 'indigo', label: 'Indigo', color: '#6366f1' },
    { id: 'blue', label: 'Blue', color: '#3b82f6' },
    { id: 'emerald', label: 'Emerald', color: '#10b981' },
    { id: 'rose', label: 'Rose', color: '#f43f5e' },
    { id: 'amber', label: 'Amber', color: '#f59e0b' },
    { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  ];
  return {
    ThemeProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useTheme: vi.fn(() => theme),
    ACCENTS,
    __theme: theme,
  };
}

/** Mock module for `src/lib/workspace.js`. */
export function createWorkspaceMock() {
  return {
    WorkspaceProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useWorkspace: vi.fn(() => ({
      workspaces: [],
      currentWorkspace: null,
      isLoading: false,
      switchWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
    })),
  };
}

interface RenderOptions {
  route?: string;
  initialEntries?: string[];
}

/**
 * Render a route element inside the providers every route needs:
 * react-query (no retries), a router, and a toaster.
 */
export function renderWithProviders(ui: ReactNode, opts: RenderOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const initialEntries = opts.initialEntries ?? [opts.route ?? '/'];
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <ProjectScopeProvider>
          <MemoryRouter initialEntries={initialEntries}>
            <ToastProvider>{ui}</ToastProvider>
          </MemoryRouter>
        </ProjectScopeProvider>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

/**
 * Render a route component that relies on `useParams`, mounted under a
 * matching <Route> so the params are populated.
 */
export function renderRoute(ui: ReactNode, opts: RenderOptions & { path: string }) {
  const { path, ...rest } = opts;
  return renderWithProviders(
    <Routes>
      <Route path={path} element={ui} />
    </Routes>,
    rest,
  );
}

/** Convenience: cast an api mock method to its vi.fn for per-test setup. */
export function mockOf(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>;
}
