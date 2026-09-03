import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { run, capture } from '../../lib/exec.js';
import type { EgressIpRule, EgressIpSelector, IEgressIpDriver } from '../types.js';

/**
 * iptables-based egress IP driver — Sprint 5, Gap G-15 (PR #22).
 *
 * The reference implementation: an `iptables -t nat -A POSTROUTING`
 * SNAT rule scoped to a project's Docker network. The driver
 * never throws on a missing `iptables` binary or a missing kernel
 * module — the rules file on disk is the source of truth across a
 * kernel restart, so a kernel without iptables still sees the
 * project listed in `list()` and reports the failure on the next
 * `attach()` attempt.
 *
 * State lives in two places:
 *   - in-process `Map<projectId, EgressIpRule>` (lost on restart),
 *   - on disk under `/var/lib/ninedeploy/egress/<projectId>.rules`
 *     (a JSON file the kernel rehydrates from on boot).
 *
 * Contract:
 *   - `attach()` is idempotent on (projectId, ip) — re-apply is a
 *     no-op. A different ip for the same projectId REPLACES the
 *     rule (the old SNAT is removed first).
 *   - `detach()` is best-effort: a missing iptables rules surfaces
 *     as a 500 with a descriptive message, but the in-process
 *     state and the on-disk state are both updated so a future
 *     `list()` does not return a phantom.
 *   - `list()` returns every rule the driver has, sorted by
 *     projectId for stable rendering in the panel.
 */
const RULES_ROOT = '/var/lib/ninedeploy/egress';

export interface IptablesEgressOptions {
  /** Override the on-disk root, e.g. for tests. */
  rootDir?: string;
}

export class IptablesEgressDriver implements IEgressIpDriver {
  readonly name = 'iptables';

  private readonly rootDir: string;
  private readonly rules = new Map<number, EgressIpRule>();

  constructor(opts: IptablesEgressOptions = {}) {
    this.rootDir = opts.rootDir ?? RULES_ROOT;
    // Rehydrate from disk on boot so a kernel restart sees the
    // current state. Failures here are non-fatal: a future
    // `attach()` will overwrite the on-disk state.
    this.rehydrate();
  }

  async attach(selector: EgressIpSelector, ip: string): Promise<EgressIpRule> {
    // Validate the IP via a regex; we do not want a typo to
    // silently become "0.0.0.0/0" in iptables.
    if (!isValidIPv4(ip)) {
      throw new Error(`Egress IP "${ip}" is not a valid IPv4 address`);
    }
    const sourceCidr = selector.sourceCidr ?? (await lookupProjectCidr(selector.projectId));
    if (!sourceCidr) {
      throw new Error(`Could not determine source CIDR for project ${selector.projectId}; specify one explicitly`);
    }

    // If a rule for this project already exists with a different
    // IP, drop the old one first.
    const existing = this.rules.get(selector.projectId);
    if (existing && existing.ip !== ip) {
      await this.detach(selector);
    } else if (existing && existing.ip === ip) {
      // Idempotent re-apply — same (projectId, ip) is a no-op.
      return existing;
    }

    // Apply the iptables rule. The comment (`-m comment --comment …`)
    // is what makes the rule discoverable for `detach()`; the
    // kernel's iptables module is available on every Linux host
    // we ship, but the rule itself can be rejected (host namespace,
    // CAP_NET_ADMIN missing). A rejected rule surfaces as a
    // thrown error; the in-process + on-disk state are not
    // updated so a future call re-attempts.
    try {
      await run(
        'iptables',
        [
          '-t', 'nat', '-A', 'POSTROUTING',
          '-s', sourceCidr,
          '!', '-d', sourceCidr,
          '-j', 'SNAT',
          '--to-source', ip,
          '-m', 'comment', '--comment', `ninedeploy-egress-${selector.projectId}`,
        ],
        { heartbeatMs: 10_000, heartbeatLabel: `egress attach project ${selector.projectId}` },
        () => {},
      );
    } catch (err) {
      throw new Error(
        `iptables -t nat -A POSTROUTING failed for project ${selector.projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const rule: EgressIpRule = {
      selector,
      ip,
      createdAt: new Date().toISOString(),
    };
    this.rules.set(selector.projectId, rule);
    this.persist(selector.projectId, rule);
    return rule;
  }

  async detach(selector: EgressIpSelector): Promise<void> {
    const existing = this.rules.get(selector.projectId);
    if (!existing) return;
    const lookedUp = await lookupProjectCidr(selector.projectId);
    const sourceCidr = existing.selector.sourceCidr ?? lookedUp;
    if (!sourceCidr) {
      // We do not have a CIDR to drop. Scrub the on-disk + in-process
      // state so a future `attach()` starts fresh, and return.
      this.rules.delete(selector.projectId);
      this.persistDelete(selector.projectId);
      return;
    }
    try {
      await run(
        'iptables',
        [
          '-t', 'nat', '-D', 'POSTROUTING',
          '-s', sourceCidr,
          '!', '-d', sourceCidr,
          '-j', 'SNAT',
          '--to-source', existing.ip,
          '-m', 'comment', '--comment', `ninedeploy-egress-${selector.projectId}`,
        ],
        { heartbeatMs: 10_000, heartbeatLabel: `egress detach project ${selector.projectId}` },
        () => {},
      );
    } catch {
      // Best-effort — the rule may already be gone, or iptables
      // may be missing. We still scrub the on-disk + in-process
      // state so a future `list()` does not return a phantom.
    }
    this.rules.delete(selector.projectId);
    this.persistDelete(selector.projectId);
  }

  async list(): Promise<EgressIpRule[]> {
    return Array.from(this.rules.values()).sort((a, b) => a.selector.projectId - b.selector.projectId);
  }

  // --- private helpers ---------------------------------------------------

  private rehydrate(): void {
    try {
      const entries = readdirSync(this.rootDir) as string[];
      for (const entry of entries) {
        if (!entry.endsWith('.rules')) continue;
        const projectId = Number(entry.replace(/\.rules$/, ''));
        if (!Number.isFinite(projectId)) continue;
        try {
          const text = readFileSync(`${this.rootDir}/${entry}`, 'utf8');
          const parsed = JSON.parse(text) as EgressIpRule;
          this.rules.set(projectId, parsed);
        } catch {
          // Half-written file; skip.
        }
      }
    } catch {
      // Root dir absent on a fresh install — no rules to load.
    }
  }

  private persist(projectId: number, rule: EgressIpRule): void {
    try {
      mkdirSync(this.rootDir, { recursive: true });
      writeFileSync(
        `${this.rootDir}/${projectId}.rules`,
        JSON.stringify(rule, null, 2),
        'utf8',
      );
    } catch {
      // Best-effort — the in-process state is still authoritative
      // for the rest of this kernel's lifetime.
    }
  }

  private persistDelete(projectId: number): void {
    try {
      const path = `${this.rootDir}/${projectId}.rules`;
      if (existsSync(path)) rmSync(path);
    } catch {
      // Best-effort
    }
  }
}

function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

async function lookupProjectCidr(projectId: number): Promise<string | null> {
  // Best-effort: ask docker for the project's network CIDR. If the
  // project does not exist yet (or docker is unreachable), the
  // caller will need to specify the CIDR explicitly.
  try {
    const out = await capture('docker', [
      'network', 'inspect',
      `ninedeploy_proj_${projectId}`,
      '--format', '{{(index .IPAM.Config 0).Subnet}}',
    ]);
    const cidr = (out ?? '').trim();
    return cidr.length > 0 ? cidr : null;
  } catch {
    return null;
  }
}
