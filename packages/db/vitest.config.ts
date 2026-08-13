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
        statements: 98, // ratcheted to current baseline
        branches: 100,
        functions: 97,
        lines: 100,
      },
    },
  },
});
