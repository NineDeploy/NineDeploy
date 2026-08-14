import { afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { type ReactNode } from 'react';
import { ToastProvider } from '../src/components/Toast.js';

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
      me: vi.fn(),
      tokens: { create: vi.fn(), list: vi.fn(), remove: vi.fn() },
    },
    services: {
      list: vi.fn(),
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
    deploys: { trigger: vi.fn(), list: vi.fn(), rollback: vi.fn() },
    domains: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), all: vi.fn(), setSsl: vi.fn() },
    volumes: { list: vi.fn(), remove: vi.fn() },
    system: { resources: vi.fn(), pruneImages: vi.fn(), exportUrl: vi.fn() },
    tunnels: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    activity: { list: vi.fn() },
    users: { list: vi.fn(), setRole: vi.fn(), remove: vi.fn() },
    about: { get: vi.fn() },
    notifications: {
      listChannels: vi.fn(),
      createChannel: vi.fn(),
      updateChannel: vi.fn(),
      removeChannel: vi.fn(),
      testChannel: vi.fn(),
      log: vi.fn(),
    },
    sources: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    webhooks: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    databases: { list: vi.fn(), create: vi.fn(), get: vi.fn(), remove: vi.fn() },
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
    health: vi.fn(),
  };
  return {
    api,
    getToken: vi.fn(() => 'test-token'),
    setToken: vi.fn(),
    deployLogsWsUrl: vi.fn(() => 'ws://localhost/v1/logs'),
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
    accent: 'indigo' as const,
    setTheme: vi.fn(),
    setAccent: vi.fn(),
    toggleTheme: vi.fn(),
  };
  const ACCENTS = [
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
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
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
