import { defineConfig } from 'vitest/config';

/**
 * Config for the testcontainers integration suite (real Docker + PostgreSQL).
 * Kept separate from the default config because that one deliberately EXCLUDES
 * test/integration — this one includes ONLY it, with no coverage gates.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Container startup is slow; give the suite room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
