import { afterEach, describe, expect, it, vi } from 'vitest';
import { s3Delete, s3Get, s3Put, s3Request, s3Test } from '../../src/lib/s3.js';

const CFG = {
  endpoint: 'https://s3.example.com',
  region: 'eu-central-1',
  bucket: 'backups',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
};

const fetchMock = vi.hoisted(() => vi.fn());

describe('s3Request signing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sends a SigV4-signed path-style request', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await s3Request(CFG, 'PUT', 'prefix/backup.enc', 'data', 'text/plain');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://s3.example.com/backups/prefix/backup.enc');
    expect(init.method).toBe('PUT');

    const headers = init.headers as Record<string, string>;
    expect(headers['host']).toBe('s3.example.com');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    // The payload hash is the sha256 hex of the body ("data").
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-central-1\/s3\/aws4_request, SignedHeaders=(content-type;)?host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    if (init.method === 'PUT') expect(headers['content-type']).toBe('text/plain');
  });

  it('uri-encodes keys with special characters', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await s3Request(CFG, 'GET', 'a b/c+d');
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(decodeURIComponent(url.pathname)).toBe('/backups/a b/c+d');
    expect(url.pathname).not.toBe('/backups/a b/c+d');
  });

  it('percent-encodes reserved characters (!\'()*) in keys', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await s3Request(CFG, 'GET', "a!b'c(d)e*f");
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toContain('a%21b%27c%28d%29e%2Af');
  });
});

describe('s3Put/Get/Delete/Test', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('s3Put throws with the body on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'AccessDenied' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(s3Put(CFG, 'k', 'x')).rejects.toThrow('S3 upload failed (403)');
  });

  it('s3Get returns bytes', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('hello').buffer });
    vi.stubGlobal('fetch', fetchMock);
    const bytes = await s3Get(CFG, 'k');
    expect(bytes.toString()).toBe('hello');
  });

  it('s3Get throws on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(s3Get(CFG, 'missing')).rejects.toThrow('S3 download failed (404)');
  });

  it('s3Delete tolerates 404 but not 403', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(s3Delete(CFG, 'gone')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => '' });
    await expect(s3Delete(CFG, 'locked')).rejects.toThrow('S3 delete failed (403)');
  });

  it('s3Test PUTs and DELETEs a marker', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await s3Test(CFG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'PUT' });
    expect((fetchMock.mock.calls[1] as unknown[])[1]).toMatchObject({ method: 'DELETE' });
  });

  it('sends Buffer bodies as bytes and string bodies as strings', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await s3Put(CFG, 'k1', Buffer.from('bytes-body'));
    expect((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body).toBeInstanceOf(Uint8Array);
    await s3Put(CFG, 'k2', 'string-body');
    expect((fetchMock.mock.calls[1] as [URL, RequestInit])[1].body).toBe('string-body');
  });

  it('sends no body for GET/DELETE/HEAD', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    await s3Get(CFG, 'k');
    await s3Delete(CFG, 'k');
    expect(((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body)).toBeUndefined();
  });
});
