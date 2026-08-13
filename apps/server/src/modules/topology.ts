import { databaseAttachments, databases, domains, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';

/** Whole-workspace graph for the topology view. Mounted under /topology. */
export const topologyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const [svcs, dbs, atts, doms] = await Promise.all([
      app.db.select().from(services),
      app.db.select().from(databases),
      app.db.select().from(databaseAttachments),
      app.db.select().from(domains),
    ]);

    return {
      services: svcs.map((s) => ({ id: s.id, name: s.name, slug: s.slug, type: s.type, status: s.status })),
      databases: dbs.map((d) => ({ id: d.id, name: d.name, engine: d.engine, status: d.status })),
      attachments: atts.map((a) => ({ id: a.id, serviceId: a.serviceId, databaseId: a.databaseId, envAlias: a.envAlias })),
      domains: doms.map((d) => ({ id: d.id, serviceId: d.serviceId, hostname: d.hostname })),
    };
  });
};
