import { eq } from 'drizzle-orm';
import { servers, type DB } from '@ninedeploy/db';
import { decrypt, randomToken } from './crypto.js';
import { open as openSealed, seal } from './agentSeal.js';
import { sha256 } from './crypto.js';
import { timingSafeEqual } from 'node:crypto';

/**
 * Agent protocol: the remote host runs the same server binary with
 * NINEDEPLOY_AGENT=1. It exposes POST /agent/exec { op, params } where `op`
 * names a TYPED operation from the agent's fixed table (the request never
 * carries a program or raw argv) — see src/agent.ts. Auth is a shared token
 * (encrypted at rest in the servers table).
 */

export interface AgentOpResult {
  exitCode: number;
  lines: string[];
}

/** Generate a fresh agent token (raw value stored encrypted, shown once). */
export function generateAgentToken(): string {
  return randomToken(32);
}

/** Constant-time sha256 token comparison (used by the agent endpoint). */
export function tokenMatches(rawToken: string, storedSha256: string): boolean {
  const a = Buffer.from(sha256(rawToken));
  const b = Buffer.from(storedSha256);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Per-process cache of "does this agent understand the sealed transport?".
 *
 * Answered by an unauthenticated `GET /agent/ping`. Cached because it is asked
 * before every operation and the answer only changes when the agent is
 * upgraded — which restarts it, and this process along with it soon enough.
 * Only an answer the agent actually gave is cached; see `supportsSealed`.
 * Exported for tests, which need to reset it between cases.
 */
const sealedSupport = new Map<number, boolean>();
export const _resetSealedSupportCache = (): void => void sealedSupport.clear();

/**
 * When set, the core refuses to fall back to the legacy cleartext transport.
 *
 * The fallback exists so a core upgraded ahead of its agents keeps working, but
 * it is also the one thing an active on-path attacker could force by stripping
 * `sealed` from a ping response. An operator who has upgraded the whole fleet
 * should close that door.
 */
const requireSealed = (): boolean => process.env['NINEDEPLOY_AGENT_REQUIRE_SEALED'] === '1';

/** Ask an agent whether it speaks the sealed protocol (cached per server). */
async function supportsSealed(serverId: number, host: string, port: number): Promise<boolean> {
  const cached = sealedSupport.get(serverId);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`http://${host}:${port}/agent/ping`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { sealed?: unknown };
    const supported = body.sealed === true;
    // Only a DEFINITIVE answer is cached. A transient failure — the agent
    // restarting, a dropped packet, or an on-path attacker dropping exactly one
    // probe — must not pin this server to the cleartext fallback for the rest
    // of the process's life. Caching a `false` we merely failed to disprove is
    // a permanent protocol downgrade an attacker gets to choose.
    sealedSupport.set(serverId, supported);
    return supported;
  } catch {
    // Unreachable right now just means "cannot confirm"; the operation itself
    // fails with a better message a moment later, and the next call re-probes.
    return false;
  }
}

/**
 * Run one typed operation on a remote agent. `sink` receives output lines;
 * non-zero exit codes throw (callers treat remote failures like local ones).
 *
 * The request is SEALED when the agent supports it (see lib/agentSeal.ts): the
 * token stops crossing the network, and so do the decrypted service secrets
 * that `file.writeEnv` carries. Older agents still get the legacy plaintext
 * request, with a warning naming the host.
 */
export async function agentOp(
  db: DB,
  serverId: number,
  op: string,
  params: Record<string, unknown>,
  sink: (line: string) => void,
): Promise<AgentOpResult> {
  const row = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!row) throw new Error('Unknown server');
  const token = decrypt(row.tokenEncrypted);
  // The agent is configured with the HASH of the token, never the raw value,
  // so the hash is the only secret both ends hold — and therefore the key
  // material for the envelope.
  const shared = sha256(token);

  const sealedOk = await supportsSealed(serverId, row.host, row.port);
  if (!sealedOk) {
    if (requireSealed()) {
      throw new Error(
        `agent ${row.host}:${row.port} does not support the encrypted transport and ` +
          'NINEDEPLOY_AGENT_REQUIRE_SEALED=1 forbids the cleartext fallback — upgrade the agent',
      );
    }
    sink(
      `⚠ agent ${row.host}:${row.port} is running an older build: this request (and any secrets in it) ` +
        'travels unencrypted. Upgrade the agent to close this.',
    );
  }

  const res = await fetch(`http://${row.host}:${row.port}/agent/exec`, {
    method: 'POST',
    headers: sealedOk
      ? { 'content-type': 'application/json' }
      : { 'content-type': 'application/json', 'x-agent-token': token },
    body: JSON.stringify(sealedOk ? { sealed: seal(shared, { op, params }) } : { op, params }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`agent ${op} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const raw = (await res.json()) as { sealed?: unknown; lines?: unknown; exitCode?: unknown };
  const body = (
    raw.sealed !== undefined ? openSealed<{ lines?: unknown; exitCode?: unknown }>(shared, raw.sealed) : raw
  ) as { lines?: unknown; exitCode?: unknown };
  const lines = Array.isArray(body.lines) ? body.lines.map(String) : [];
  for (const l of lines) sink(l);
  const exitCode = Number(body.exitCode) || 0;
  if (exitCode !== 0) throw new Error(`agent ${op} exited with ${exitCode}`);
  return { exitCode, lines };
}

/** Probe an agent's reachability + auth (used by the servers routes + UI). */
export async function agentPing(host: string, port: number, token: string): Promise<void> {
  const res = await fetch(`http://${host}:${port}/agent/ping`, {
    headers: { 'x-agent-token': token },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`agent unreachable (${res.status})`);
}
