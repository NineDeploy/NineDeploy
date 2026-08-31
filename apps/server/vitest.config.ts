import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    exclude: [
      'test/integration/**',
      'test/diag/**',
      '**/node_modules/**',
      '**/dist/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // types.ts and index.ts are interfaces-only / barrel re-exports.
      exclude: ['src/engine/types.ts', 'src/kernel/types.ts', 'src/kernel/index.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
      // The README advertises 100% coverage; the actual reachable coverage
      // today is ~97% statements / ~94% branches once every defensive code
      // path is counted (the remaining gap is mostly unreachable error-shape
      // branches in third-party-style helpers). The Sprint 11 PR set
      // (PRs #45–#58) added ~200 new tests and pushed statements from
      // 88.12% to 93.65% (+5.53pp) and branches from 86.00% to 88.44%
      // (+2.44pp). The remaining gap is pre-Sprint 11 code that's
      // scheduled for dedicated follow-up PRs (each surface gets its
      // own coverage push). The floor reflects the current reachable
      // baseline so the gate catches real regressions without blocking
      // on lines that are outside Sprint 11's scope — the goal remains
      // 100. See CHANGELOG for the per-PR coverage delta.
      thresholds: {
        statements: 93.6,
        branches: 88.4,
        functions: 93,
        lines: 95.1,
      },
    },
  },
});
