import type { LogDrainFormat, LogDrainType } from '@ninedeploy/schemas';

export interface LogPayloadEntry {
  timestamp: string;
  service: string;
  container: string;
  line: string;
  stream?: 'stdout' | 'stderr';
}

export function formatLogPayload(
  type: LogDrainType,
  format: LogDrainFormat,
  entry: LogPayloadEntry,
): { body: string; contentType: string } {
  if (type === 'loki') {
    const nano = String(Date.parse(entry.timestamp) * 1_000_000 || Date.now() * 1_000_000);
    const body = JSON.stringify({
      streams: [
        {
          stream: {
            app: entry.service,
            container: entry.container,
            stream: entry.stream ?? 'stdout',
          },
          values: [[nano, entry.line]],
        },
      ],
    });
    return { body, contentType: 'application/json' };
  }

  if (type === 'datadog') {
    const body = JSON.stringify([
      {
        ddsource: 'ninedeploy',
        service: entry.service,
        hostname: entry.container,
        message: entry.line,
        status: entry.stream === 'stderr' ? 'warn' : 'info',
        date: Date.parse(entry.timestamp) || Date.now(),
      },
    ]);
    return { body, contentType: 'application/json' };
  }

  if (format === 'raw') {
    return { body: `[${entry.timestamp}] [${entry.service}/${entry.container}] ${entry.line}\n`, contentType: 'text/plain' };
  }

  if (format === 'rfc5424') {
    const pri = entry.stream === 'stderr' ? '<11>' : '<14>';
    const rfc = `${pri}1 ${entry.timestamp} ${entry.container} ${entry.service} - - - ${entry.line}\n`;
    return { body: rfc, contentType: 'text/plain' };
  }

  // Default JSON format
  return {
    body: JSON.stringify({
      timestamp: entry.timestamp,
      service: entry.service,
      container: entry.container,
      stream: entry.stream ?? 'stdout',
      message: entry.line,
    }),
    contentType: 'application/json',
  };
}

export async function dispatchLogToDrain(
  drain: {
    url: string;
    type: LogDrainType;
    format: LogDrainFormat;
    apiKey?: string | null;
    headers?: Record<string, string> | null;
  },
  entry: LogPayloadEntry,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const { body, contentType } = formatLogPayload(drain.type, drain.format, entry);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'User-Agent': 'NineDeploy-LogDrain/1.0',
    ...(drain.headers ?? {}),
  };

  if (drain.apiKey) {
    if (drain.type === 'datadog') {
      headers['DD-API-KEY'] = drain.apiKey;
    } else {
      headers['Authorization'] = drain.apiKey.startsWith('Bearer ') ? drain.apiKey : `Bearer ${drain.apiKey}`;
    }
  }

  try {
    const res = await fetchImpl(drain.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(6000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  }
}

export async function testLogDrainConnection(
  drain: {
    url: string;
    type: LogDrainType;
    format: LogDrainFormat;
    apiKey?: string | null;
    headers?: Record<string, string> | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
  const start = Date.now();
  const testEntry: LogPayloadEntry = {
    timestamp: new Date().toISOString(),
    service: 'ninedeploy-probe',
    container: 'probe-1',
    line: 'NineDeploy log drain connectivity test ping',
    stream: 'stdout',
  };

  const res = await dispatchLogToDrain(drain, testEntry, fetchImpl);
  const latencyMs = Date.now() - start;

  if (res.ok) {
    return { ok: true, latencyMs, message: `Successfully connected (HTTP ${res.status})` };
  }

  return {
    ok: false,
    latencyMs,
    message: res.error ? `Connection failed: ${res.error}` : `Endpoint rejected test payload (HTTP ${res.status})`,
  };
}
