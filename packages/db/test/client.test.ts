import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';

describe('createDb', () => {
  it('creates an in-memory database and runs queries', async () => {
    const { db, client } = createDb({ url: ':memory:' });
    expect(client).toBeDefined();
    const result = await db.run(sql`SELECT 1 as one`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ one: 1 });
  });

  it('accepts an auth token', async () => {
    const { db } = createDb({ url: ':memory:', authToken: 'secret' });
    const result = await db.run(sql`SELECT 2 as two`);
    expect(result.rows[0]).toEqual({ two: 2 });
  });

  it('returns the raw libsql client when withClient is true', async () => {
    const { db, client } = createDb({ url: ':memory:', withClient: true });
    expect(typeof client.execute).toBe('function');
    const result = await db.run(sql`SELECT 3 as three`);
    expect(result.rows[0]).toEqual({ three: 3 });
  });
});
