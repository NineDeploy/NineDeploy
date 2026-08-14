import { eq } from 'drizzle-orm';
import { audit } from "../lib/audit.js";
import { domains, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { readCertificates, writeDynamicConfig } from '../engine/proxy.js';
import { notFound } from '../lib/errors.js';

/** Centralized domain index: which domain → which service/container, plus SSL. Mounted under /domains. */
export const domainIndexRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const rows = await app.db.query.domains.findMany();
    const svcs = await app.db.select().from(services);
    const byId = new Map(svcs.map((s) => [s.id, s]));
    // Certificate expiry comes from Traefik's ACME storage (empty without ACME).
    const certs = new Map(readCertificates().map((c) => [c.domain, c.expiresAt]));
    return rows.map((d) => {
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
    const id = Number((req.params as { id: string }).id);
    const input = (req.body ?? {}) as { ssl?: boolean };
    const [d] = await app.db.update(domains).set({ ssl: input.ssl ?? false, status: 'active' }).where(eq(domains.id, id)).returning();
    if (!d) throw notFound('Domain not found');
    await writeDynamicConfig(app.db);
    void audit(app.db, req.user!.id, 'domain.ssl', d.hostname + ' → ' + (d.ssl ? 'on' : 'off'));
    return { id: d.id, ssl: d.ssl };
  });
};
