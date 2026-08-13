import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: {
        statements: 100,
        branches: 96, // ratcheted to current baseline (~97%)
        functions: 100,
        lines: 100,
      },
    },
  },
});
