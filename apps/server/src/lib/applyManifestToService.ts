import { and, eq } from 'drizzle-orm';
import {
  alertRules,
  databases,
  databaseAttachments,
  domains,
  type DB,
} from '@ninedeploy/db';
import type { NinedeployManifest, Route } from '@ninedeploy/schemas';
import { ensureAlertState } from './alerting.js';
import { isOperator, visibleDatabaseIds } from './resourceAccess.js';

/**
 * Apply a `.ninedeploy` manifest's operational sections onto an existing
 * service. Called once per deploy (after a successful build) so the
 * side-effects stay in sync with the repo: re-running the deploy refreshes
 * routes, alerts and the managed-DB attachment to whatever the manifest
 * declares today.
 *
 * Everything here is **idempotent** — re-running an unchanged manifest
 * produces the same DB state. Domains are matched by (hostname, path),
 * alert rules by their generated `name`, and database attachments by the
 * unique (serviceId, databaseId) index. No new rows are created on a
 * no-op run.
 *
 * Three sections are fully wired here (routes, database, alerts); the
 * build-shaping ones are applied by `engine/pipeline.ts` instead. Six are
 * *recognised but not wired* — `volume.backups`, `notifications`, `previews`,
 * `static`, `watch` and `network` — because the underlying platform feature is
 * either a panel/operator setting or does not exist yet. Every one of them
 * pushes a warning so the operator sees in the deploy log that the section was
 * read and had no effect; a section that is accepted by the schema and then
 * silently dropped is the failure mode this list exists to prevent.
 */

export interface ApplyManifestResult {
  routesUpserted: number;
  routesRemoved: number;
  databaseAttached: boolean;
  databaseNotFound: string | null;
  /** Set when a `database.ref` was found but is outside the deploying
   * service-owner's visibility — the cross-tenant attach is refused. */
  databaseAccessDenied: string | null;
  alertsUpserted: number;
  warnings: string[];
}

export async function applyManifestToService(
  db: DB,
  serviceId: number,
  manifest: NinedeployManifest,
  ownerUserId?: number | null,
): Promise<ApplyManifestResult> {
  const result: ApplyManifestResult = {
    routesUpserted: 0,
    routesRemoved: 0,
    databaseAttached: false,
    databaseNotFound: null,
    databaseAccessDenied: null,
    alertsUpserted: 0,
    warnings: [],
  };

  await syncRoutes(db, serviceId, manifest.routes, result);
  await attachManagedDatabase(db, serviceId, ownerUserId ?? null, manifest.database, result);
  await syncAlertRules(db, serviceId, manifest.alerts, result);

  // Recognised-but-not-wired sections: surface so the build log records the
  // operator's intent without silently dropping the configuration.
  if (manifest.volume?.backups) {
    result.warnings.push(
      `volume.backups: schedule="${manifest.volume.backups.schedule}" declared but volume-backup cron wiring is not yet implemented (PR 4+).`,
    );
  }
  if (manifest.notifications) {
    const channels = [
      ...manifest.notifications.onDeploy,
      ...manifest.notifications.onFailure,
      ...manifest.notifications.onAlert,
    ];
    if (channels.length > 0) {
      result.warnings.push(
        `notifications: channels=[${[...new Set(channels)].join(', ')}] declared but per-service event mapping is not yet implemented.`,
      );
    }
  }
  if (manifest.previews?.enabled) {
    result.warnings.push(
      `previews: pattern="${manifest.previews.pattern ?? ''}" declared but preview config wiring is not yet implemented.`,
    );
  }
  // `static`, `watch` and `network` are accepted by the schema (a `.strict()`
  // object would otherwise reject a manifest that uses them) and consumed by
  // nothing. They were the only unwired sections that stayed completely silent,
  // so a repo declaring `static.spa: true` or a `watch` path filter got no hint
  // that the setting had no effect at all.
  if (manifest.static) {
    result.warnings.push(
      'static: declared but static-site serving is configured in the panel (Service → Settings), not from the manifest; section ignored.',
    );
  }
  if (manifest.watch) {
    result.warnings.push(
      'watch: declared but build-path filtering is driven by the webhook\'s watch paths (Service → Webhooks); section ignored.',
    );
  }
  if (manifest.network) {
    result.warnings.push(
      'network: declared but container network attachment is a panel/operator setting (Networks); section ignored.',
    );
  }

  return result;
}

// ── Routes (domains) ─────────────────────────────────────────────────────

async function syncRoutes(
  db: DB,
  serviceId: number,
  routes: readonly Route[] | undefined,
  result: ApplyManifestResult,
): Promise<void> {
  const existing = await db
    .select()
    .from(domains)
    .where(eq(domains.serviceId, serviceId));

  if (!routes || routes.length === 0) {
    // No routes declared → leave existing domains alone. Removing routes
    // through the manifest would be too aggressive (the operator might be
    // editing a working draft) — they can use the panel for explicit deletes.
    return;
  }

  // Rows this run created, keyed by (hostname, path). `existing` is a snapshot
  // taken before the loop, so it cannot see them — and `domains` enforces
  // (hostname, path) uniqueness GLOBALLY (`domains_host_path_idx`), not per
  // service. Without this, a manifest listing the same route twice
  // blind-INSERTs into that index and the deploy dies on a raw UNIQUE error.
  const created = new Map<string, { id: number }>();

  for (const route of routes) {
    const hostname = route.host.toLowerCase();
    const path = route.path;
    const headers = route.headers ? JSON.stringify(toHeaderRows(route.headers)) : null;
    const ipAllowlist = route.ipAllowlist ? route.ipAllowlist.join(', ') : null;
    const rateAverage = route.rateLimit?.average ?? null;
    const rateBurst = route.rateLimit?.burst ?? null;

    const key = `${hostname}|${path}`;
    const match = existing.find((d) => d.hostname === hostname && d.path === path) ?? created.get(key);
    if (match) {
      await db
        .update(domains)
        .set({
          ssl: route.ssl,
          redirectWww: route.redirectWww ?? false,
          headers,
          ipAllowlist,
          rateLimitAverage: rateAverage,
          rateLimitBurst: rateBurst,
          // We do NOT change verificationToken / verifiedAt / status here —
          // DNS verification is the panel's job, not the manifest's.
          updatedAt: new Date(),
        })
        .where(eq(domains.id, match.id));
    } else {
      // The uniqueness is global: a (hostname, path) another service already
      // registered is claimed. Skip it with a warning — the same graceful
      // refusal `assertHostnameClaimable` gives the panel flow — instead of
      // crashing the deploy on the raw UNIQUE constraint.
      const claimedBy = await db
        .select({ serviceId: domains.serviceId })
        .from(domains)
        .where(and(eq(domains.hostname, hostname), eq(domains.path, path)))
        .limit(1);
      if (claimedBy.length > 0) {
        result.warnings.push(
          `routes: ${hostname}${path} is already registered to service #${claimedBy[0]!.serviceId}; manifest route skipped.`,
        );
        continue;
      }
      // Newly declared route: insert in `pending` state. The platform's
      // existing DNS-challenge flow will lift it to `active` once the
      // operator proves ownership (or immediately if the host is in the
      // instance's own zone).
      const [createdRow] = await db
        .insert(domains)
        .values({
          serviceId,
          hostname,
          path,
          ssl: route.ssl,
          redirectWww: route.redirectWww ?? false,
          headers,
          ipAllowlist,
          rateLimitAverage: rateAverage,
          rateLimitBurst: rateBurst,
          basicAuth: null,
          status: 'pending',
          verificationToken: null,
          dnsRecordId: null,
        })
        .returning({ id: domains.id });
      if (createdRow) created.set(key, createdRow);
    }
    result.routesUpserted += 1;
  }
}

function toHeaderRows(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

// ── Managed database attachment ──────────────────────────────────────────

async function attachManagedDatabase(
  db: DB,
  serviceId: number,
  ownerUserId: number | null,
  ref: NinedeployManifest['database'],
  result: ApplyManifestResult,
): Promise<void> {
  if (!ref) return;
  const dbRows = await db
    .select()
    .from(databases)
    .where(eq(databases.slug, ref.ref))
    .limit(1);
  const dbRow = dbRows[0];
  if (!dbRow) {
    result.databaseNotFound = ref.ref;
    result.warnings.push(
      `database.ref="${ref.ref}" does not match any managed database; attach skipped.`,
    );
    return;
  }
  // Authorization: the manifest comes from the repository, so anyone with
  // push access could name ANY managed database by its deterministic slug and
  // have its connection string (password included) injected into this
  // service's env. Only attach databases visible to the deploying service's
  // owner — mirroring loadDatabaseForUser, minus any session-based bypass.
  if (!ownerUserId) {
    result.databaseAccessDenied = ref.ref;
    result.warnings.push(
      `database.ref="${ref.ref}": the deploying service has no recorded owner, so manifest-driven attachments are refused.`,
    );
    return;
  }
  const ownerIsOperator = await isOperator(db, { id: ownerUserId });
  const visibleIds = await visibleDatabaseIds(db, { id: ownerUserId, isOperator: ownerIsOperator });
  if (visibleIds !== null && !visibleIds.includes(dbRow.id)) {
    result.databaseAccessDenied = ref.ref;
    result.warnings.push(
      `database.ref="${ref.ref}" points at a managed database outside this service's access; attach skipped.`,
    );
    return;
  }
  // INSERT OR IGNORE — the unique (serviceId, databaseId) index already
  // covers dedup; we only need to set envAlias on first insert.
  const existing = await db
    .select()
    .from(databaseAttachments)
    .where(
      and(
        eq(databaseAttachments.serviceId, serviceId),
        eq(databaseAttachments.databaseId, dbRow.id),
      ),
    );
  if (existing.length === 0) {
    await db.insert(databaseAttachments).values({
      serviceId,
      databaseId: dbRow.id,
      envAlias: ref.env,
    });
  }
  result.databaseAttached = true;
}

// ── Alert rules ──────────────────────────────────────────────────────────

async function syncAlertRules(
  db: DB,
  serviceId: number,
  alerts: NinedeployManifest['alerts'],
  result: ApplyManifestResult,
): Promise<void> {
  if (!alerts || alerts.length === 0) return;

  for (const alert of alerts) {
    // Map the manifest's "when" to a (metric, operator, threshold) triple.
    // The schema has a separate "channel" string from the alert rule's own
    // "name" — we encode the channel into the rule name so multiple alerts
    // with the same `when` but different channels coexist.
    const rule = alertToRule(alert);
    if (!rule) {
      // Event-shaped alert with no metric behind it. Writing SOMETHING here
      // used to produce a `cert-expiry < 0` rule — a rule that can never fire
      // and that shows up in Monitoring looking like a configured alert. Say
      // it was skipped instead.
      result.warnings.push(
        `alerts: when="${alert.when}" is an event, not a metric threshold, and per-service event alerts are not yet implemented; rule skipped.`,
      );
      continue;
    }
    const { metric, operator, threshold, durationWindows } = rule;
    const name = `svc-${serviceId}-${alert.when}-${alert.channel}`;

    const existing = await db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.serviceId, serviceId), eq(alertRules.name, name)));

    if (existing.length > 0) {
      await db
        .update(alertRules)
        .set({ metric, operator, threshold, durationWindows, updatedAt: new Date() })
        .where(eq(alertRules.id, existing[0]!.id));
      // Re-applies must heal a missing state row but never wipe live breach
      // state — ensure only INSERTs when the row is absent.
      await ensureAlertState(db, existing[0]!.id);
    } else {
      const [created] = await db
        .insert(alertRules)
        .values({
          serviceId,
          name,
          metric,
          operator,
          threshold,
          durationWindows,
          enabled: true,
        })
        .returning({ id: alertRules.id });
      // evaluateAlerts only UPDATEs alert_state by ruleId — a rule without a
      // state row can never leave 'ok' (breachSince restarts every tick), so
      // creation must seed one.
      if (created) await ensureAlertState(db, created.id);
    }
    result.alertsUpserted += 1;
  }
}

/**
 * Translate one manifest alert into an `alert_rules` row, or `null` when the
 * trigger is event-shaped (`deployFailed`, `restartLoop`) and the metric-based
 * alert engine has nothing to evaluate. The caller turns `null` into a warning
 * rather than inventing a rule.
 */
function alertToRule(alert: NonNullable<NinedeployManifest['alerts']>[number]): {
  metric: 'cpu' | 'memory' | 'cert-expiry';
  operator: '>' | '<';
  threshold: number;
  durationWindows: number;
} | null {
  switch (alert.when) {
    case 'highMemory':
      return {
        metric: 'memory',
        operator: '>',
        threshold: alert.thresholdPct ?? 90,
        durationWindows: 3,
      };
    case 'highCpu':
      return {
        metric: 'cpu',
        operator: '>',
        threshold: alert.thresholdPct ?? 90,
        durationWindows: 3,
      };
    case 'certExpiry':
      return { metric: 'cert-expiry', operator: '<', threshold: 14, durationWindows: 1 };
    case 'deployFailed':
    case 'restartLoop':
      // Event-shaped: the alert engine evaluates metric samples, and there is
      // no metric that means "the last deploy failed". `deploy.failed` reaches
      // notification channels directly from the deploy pipeline; a per-service
      // routing of it belongs with the `notifications` section.
      return null;
  }
}
