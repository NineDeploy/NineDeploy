import { and, eq } from 'drizzle-orm';
import { domains, services, type Domain } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createDomain } from '@ninedeploy/schemas';
import { writeDynamicConfig } from '../engine/proxy.js';
import { conflict, notFound } from '../lib/errors.js';

const num = (v: string) => Number(v);

function serialize(d: Domain) {
  return {
    id: d.id,
    serviceId: d.serviceId,
    hostname: d.hostname,
    path: d.path,
    ssl: d.ssl,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Domain (Traefik routing) management for a service. Mounted under /services. */
export const domainsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/:id/domains', async (req) => {
    const id = num((req.params as { id: string }).id);
    const rows = await app.db.query.domains.findMany({ where: eq(domains.serviceId, id) });
    return rows.map(serialize);
  });

  app.post('/:id/domains', async (req) => {
    const id = num((req.params as { id: string }).id);
    const input = createDomain.parse(req.body);
    const svc = await app.db.query.services.findFirst({ where: eq(services.id, id) });
    if (!svc) throw notFound('Service not found');

    const [d] = await app.db
      .insert(domains)
      .values({
        serviceId: id,
        hostname: input.hostname,
        path: input.path,
        ssl: input.ssl,
        status: 'active',
      })
      .returning()
      .catch(() => [] as Domain[]);
    if (!d) throw conflict('A domain with that host already exists');
    await writeDynamicConfig(app.db);
    return serialize(d);
  });

  app.delete('/:id/domains/:domainId', async (req) => {
    const id = num((req.params as { id: string }).id);
    const domainId = num((req.params as { domainId: string }).domainId);
    await app.db.delete(domains).where(and(eq(domains.id, domainId), eq(domains.serviceId, id)));
    await writeDynamicConfig(app.db);
    return { ok: true };
  });
};
