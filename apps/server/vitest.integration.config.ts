import { defineConfig } from 'vitest/config';

/**
 * Config for the testcontainers integration suite (real Docker: PostgreSQL,
 * MySQL, Redis, MongoDB backup/restore + an end-to-end deploy pipeline run).
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
