import { describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({
  execute: vi.fn().mockRejectedValue(new Error('pragma failed')),
}));

vi.mock('@libsql/client', () => ({
  createClient: () => ({ execute }),
}));

import { createDb } from '../src/client.js';

describe('createDb error tolerance', () => {
  it('swallows a failing PRAGMA foreign_keys execute', async () => {
    const { client } = createDb({ url: ':memory:' });
    expect(execute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    expect(client).toBeDefined();
  });
});
