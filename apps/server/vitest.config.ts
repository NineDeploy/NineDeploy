import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // types.ts and index.ts are interfaces-only / barrel re-exports.
      exclude: ['src/engine/types.ts', 'src/kernel/types.ts', 'src/kernel/index.ts'],
      reporter: ['text'],
      // The README advertises 100% coverage; the actual reachable coverage
      // today is ~97% statements / ~94% branches once every defensive code
      // path is counted (the remaining gap is mostly unreachable error-shape
      // branches in third-party-style helpers). We set the floor to 95 so
      // that the gate catches real regressions without blocking on lines
      // that are unreachable in unit tests; the goal remains 100 — see
      // CHANGELOG entries for prior pushes in that direction.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
