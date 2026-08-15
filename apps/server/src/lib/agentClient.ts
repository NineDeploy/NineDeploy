import { eq } from 'drizzle-orm';
import { servers, type DB } from '@ninedeploy/db';
import { decrypt, randomToken } from './crypto.js';
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
 * Run one typed operation on a remote agent. `sink` receives output lines;
 * non-zero exit codes throw (callers treat remote failures like local ones).
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

  const res = await fetch(`http://${row.host}:${row.port}/agent/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-token': token },
    body: JSON.stringify({ op, params }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`agent ${op} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { lines?: unknown; exitCode?: unknown };
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
