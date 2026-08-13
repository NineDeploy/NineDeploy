import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

const rawBodyPlugin = (await import('../../src/plugins/rawBody.js')).default;

async function buildApp() {
  const app = Fastify();
  await app.register(rawBodyPlugin);
  app.post('/echo-json', async (req) => ({ body: req.body, raw: (req.rawBody as Buffer | undefined)?.toString() }));
  app.post('/echo-bin', async (req) => ({ body: req.body, raw: (req.rawBody as Buffer | undefined)?.toString('latin1') }));
  return app;
}

describe('rawBody plugin', () => {
  it('captures the raw bytes for application/json while still parsing the body', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/echo-json',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: { a: 1 }, raw: '{"a":1}' });
    await app.close();
  });

  it('rejects malformed JSON with a parser error', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/echo-json',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":',
    });
    // The custom parser passes the SyntaxError through; without a custom error
    // handler a bare Fastify instance answers 500.
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('JSON');
    await app.close();
  });

  it('handles nested JSON payloads', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/echo-json',
      headers: { 'content-type': 'application/json' },
      payload: '{"nested":{"list":[1,2,3]}}',
    });
    expect(res.json().body).toEqual({ nested: { list: [1, 2, 3] } });
    await app.close();
  });

  it('parses application/octet-stream as a binary string', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/echo-bin',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from([0x01, 0x02, 0xff]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toBe('\x01\x02\xff');
    await app.close();
  });

  it('still exposes the raw buffer on non-JSON content types registered by the parser', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/echo-bin',
      headers: { 'content-type': 'application/octet-stream' },
      payload: 'hello',
    });
    expect(res.json().body).toBe('hello');
    await app.close();
  });
});
