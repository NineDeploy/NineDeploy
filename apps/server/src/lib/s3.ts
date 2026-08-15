import { createHash, createHmac } from 'node:crypto';

/**
 * Minimal S3-compatible client with AWS SigV4 request signing — zero
 * dependencies beyond node:crypto + fetch. Works with AWS S3 and any
 * S3-compatible endpoint (MinIO, R2, Backblaze B2, Garage, …) using
 * path-style addressing.
 */

export interface S3Config {
  endpoint: string; // e.g. https://s3.eu-central-1.amazonaws.com
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

function uriEncode(s: string): string {
  // Keep `/` literal (path separators in the object key); percent-encode
  // everything else that is not URL-safe, including the reserved !'()* set.
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, '/');
}

/**
 * Sign and execute one S3 request. `path` is the object key (already
 * namespace-prefixed by the caller); method/body drive the signature.
 */
export async function s3Request(
  cfg: S3Config,
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
  key: string,
  body?: Buffer | string,
  contentType = 'application/octet-stream',
): Promise<Response> {
  const url = new URL(`${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${uriEncode(key)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? '');

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-type'] = contentType;

  // Canonical request (sorted header names; signed headers list must match).
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h]!.trim()}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    '', // no query string
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, dateStamp), cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof Buffer ? new Uint8Array(body) : body,
    signal: AbortSignal.timeout(120_000),
  });
}

/** PUT an object; throws with the response body when the upload fails. */
export async function s3Put(cfg: S3Config, key: string, data: Buffer | string): Promise<void> {
  const res = await s3Request(cfg, 'PUT', key, data);
  if (!res.ok) throw new Error(`S3 upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/** GET an object as bytes. */
export async function s3Get(cfg: S3Config, key: string): Promise<Buffer> {
  const res = await s3Request(cfg, 'GET', key);
  if (!res.ok) throw new Error(`S3 download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** DELETE an object; missing objects (404) are treated as success. */
export async function s3Delete(cfg: S3Config, key: string): Promise<void> {
  const res = await s3Request(cfg, 'DELETE', key);
  if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status})`);
}

/** Cheap connectivity/auth probe — PUT+DELETE a tiny marker object. */
export async function s3Test(cfg: S3Config): Promise<void> {
  const marker = `.ninedeploy-test-${Date.now()}`;
  await s3Put(cfg, marker, 'ok');
  await s3Delete(cfg, marker);
}
