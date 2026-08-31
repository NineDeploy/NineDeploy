import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // vite-env.d.ts is a type declaration (no runtime code).
      exclude: ['src/vite-env.d.ts'],
      reporter: ['text'],
      thresholds: {
        // The dashboard surface is large (manifest creator alone
        // carries 78% line coverage because three modal-close paths
        // and a handful of keyboard handlers are not exercised) and
        // any global threshold above ~98% is a flake factory. 98%
        // is the realistic floor: the rest is mostly dead defensive
        // UI handlers (close-on-backdrop, close-on-Escape, copy-to-
        // clipboard) where a behavioural test would just re-pin what
        // an end-to-end Playwright run already covers.
        statements: 98,
        branches: 92,
        functions: 98,
        lines: 98,
      },
    },
  },
});
