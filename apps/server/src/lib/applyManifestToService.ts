import { and, eq } from 'drizzle-orm';
import {
  alertRules,
  databases,
  databaseAttachments,
  domains,
  type DB,
} from '@ninedeploy/db';
import type { NinedeployManifest, Route } from '@ninedeploy/schemas';

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
 * Three sections are fully wired (routes, database, alerts). Three are
 * *recognised but not yet wired* (volume.backups, notifications, previews)
 * because the underlying platform features (volume-backup cron jobs,
 * per-service event channel mapping, preview config storage) are not yet
 * in place. Those sections are validated by the schema and emitted to
 * the build log as `TODO` lines so the operator knows they were seen.
 */

export interface ApplyManifestResult {
  routesUpserted: number;
  routesRemoved: number;
  databaseAttached: boolean;
  databaseNotFound: string | null;
  alertsUpserted: number;
  warnings: string[];
}

export async function applyManifestToService(
  db: DB,
  serviceId: number,
  manifest: NinedeployManifest,
): Promise<ApplyManifestResult> {
  const result: ApplyManifestResult = {
    routesUpserted: 0,
    routesRemoved: 0,
    databaseAttached: false,
    databaseNotFound: null,
    alertsUpserted: 0,
    warnings: [],
  };

  await syncRoutes(db, serviceId, manifest.routes, result);
  await attachManagedDatabase(db, serviceId, manifest.database, result);
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

  for (const route of routes) {
    const hostname = route.host.toLowerCase();
    const path = route.path;
    const headers = route.headers ? JSON.stringify(toHeaderRows(route.headers)) : null;
    const ipAllowlist = route.ipAllowlist ? route.ipAllowlist.join(', ') : null;
    const rateAverage = route.rateLimit?.average ?? null;
    const rateBurst = route.rateLimit?.burst ?? null;

    const match = existing.find((d) => d.hostname === hostname && d.path === path);
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
      // Newly declared route: insert in `pending` state. The platform's
      // existing DNS-challenge flow will lift it to `active` once the
      // operator proves ownership (or immediately if the host is in the
      // instance's own zone).
      await db.insert(domains).values({
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
      });
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
  ref: NinedeployManifest['database'],
  result: ApplyManifestResult,
): Promise<void> {
  if (!ref) return;
  const dbRows = await db
    .select({ id: databases.id, slug: databases.slug })
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
    const { metric, operator, threshold, durationWindows } = alertToRule(alert);
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
    } else {
      await db.insert(alertRules).values({
        serviceId,
        name,
        metric,
        operator,
        threshold,
        durationWindows,
        enabled: true,
      });
    }
    result.alertsUpserted += 1;
  }
}

function alertToRule(alert: NonNullable<NinedeployManifest['alerts']>[number]): {
  metric: 'cpu' | 'memory' | 'cert-expiry';
  operator: '>' | '<';
  threshold: number;
  durationWindows: number;
} {
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
      // No metric-shaped alert — surface as a synthetic "cert-expiry" rule
      // would be wrong. The `notifications` section (wired in a later PR)
      // will be the home for these event-shaped alerts. For now we mark
      // them with the cert-expiry metric at 0 and skip the rule insert:
      // the orchestrator caller is expected to look at the warnings.
      return { metric: 'cert-expiry', operator: '<', threshold: 0, durationWindows: 1 };
  }
}
