import { eq, inArray } from 'drizzle-orm';
import { audit } from '../lib/audit.js';
import { domains, services, serviceWorkspaces, workspaceMembers } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { readCertificates, writeDynamicConfig } from '../engine/proxy.js';
import { notFound, parseId } from '../lib/errors.js';

import { loadServiceForUser } from '../lib/serviceAccess.js';

/** Centralized domain index: which domain → which service/container, plus SSL. Mounted under /domains. */
export const domainIndexRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => {
    const user = req.user!;
    const [rows, allServices, userWsMemberships] = await Promise.all([
      app.db.query.domains.findMany(),
      app.db.select().from(services),
      app.db
        .select({ id: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, user.id)),
    ]);
    const userWsIds = userWsMemberships.map((w) => w.id);
    const visibleServiceIds = user.isOperator
      ? new Set(allServices.map((s) => s.id))
      : await (async () => {
          if (userWsIds.length === 0) {
            const owned = await app.db
              .select({ id: services.id })
              .from(services)
              .where(eq(services.ownerUserId, user.id));
            return new Set(owned.map((s) => s.id));
          }
          const [owned, tagged] = await Promise.all([
            app.db.select({ id: services.id }).from(services).where(eq(services.ownerUserId, user.id)),
            app.db
              .select({ id: serviceWorkspaces.serviceId })
              .from(serviceWorkspaces)
              .where(inArray(serviceWorkspaces.workspaceId, userWsIds)),
          ]);
          const set = new Set<number>();
          for (const r of owned) set.add(r.id);
          for (const r of tagged) set.add(r.id);
          return set;
        })();
    const svcs = allServices.filter((s) => visibleServiceIds.has(s.id));
    const byId = new Map(svcs.map((s) => [s.id, s]));
    const visibleRows = rows.filter((domain) => byId.has(domain.serviceId));
    // Certificate expiry comes from Traefik's ACME storage (empty without ACME).
    const certs = new Map(readCertificates().map((c) => [c.domain, c.expiresAt]));
    return visibleRows.map((d) => {
      const s = byId.get(d.serviceId);
      return {
        id: d.id,
        hostname: d.hostname,
        path: d.path,
        ssl: d.ssl,
        status: d.status,
        serviceId: d.serviceId,
        serviceName: s?.name ?? null,
        container: s?.runtimeId ?? null,
        port: s?.port ?? null,
        certExpiresAt: certs.get(d.hostname)?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      };
    });
  });

  app.patch('/:id', async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const input = (req.body ?? {}) as { ssl?: boolean };
    const domain = await app.db.query.domains.findFirst({ where: eq(domains.id, id) });
    if (!domain) throw notFound('Domain not found');
    await loadServiceForUser(app.db, domain.serviceId, req.user!);
    const [d] = await app.db.update(domains).set({ ssl: input.ssl ?? false, status: 'active' }).where(eq(domains.id, id)).returning();
    if (!d) throw notFound('Domain not found');
    await writeDynamicConfig(app.db);
    void audit(app.db, req.user!.id, 'domain.ssl', `${d.hostname} → ${d.ssl ? 'on' : 'off'}`);
    return { id: d.id, ssl: d.ssl };
  });
};
