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
        // Strict thresholds are aspirational but unrealistic for large UI
        // pages: the Manifest Creator page alone has 78% line coverage
        // because many of its branches are gated on user flows the
        // existing tests do not exercise (e.g. the modal "X" button
        // vs. Escape key vs. backdrop click — only one path is hit in
        // the page-level tests). 99% global is a pragmatic floor that
        // still keeps a tight feedback loop without forcing redundant
        // edge-case tests that don't change behavior.
        statements: 99,
        branches: 95,
        functions: 99,
        lines: 99,
      },
    },
  },
});
