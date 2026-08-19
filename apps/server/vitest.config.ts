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
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
