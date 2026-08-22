import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so React Testing Library's automatic cleanup
// never registers — unmount explicitly between tests or renders leak across
// tests and collide on shared texts.
afterEach(() => {
  cleanup();
});
