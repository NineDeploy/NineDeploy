import { databaseAttachments, databases, domains, services } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { TRAEFIK_CONTAINER, NETWORK } from '../engine/proxy.js';
import {
  containerRunning,
  listManagedVolumeNames,
  listUserNetworks,
  networkMembers,
  resolveVolumeOwner,
} from '../lib/inventory.js';

/** Whole-workspace graph for the topology view. Mounted under /topology.
 *
 * Layers: domains → traefik gateway → services → databases, plus the
 * infrastructure underneath — docker volumes (with owner links) and networks
 * (with member lists on the shared mesh). Docker probes are fault-tolerant:
 * with the daemon down the graph still renders, just without runtime layers. */
export const topologyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const [svcs, dbs, atts, doms] = await Promise.all([
      app.db.select().from(services),
      app.db.select().from(databases),
      app.db.select().from(databaseAttachments),
      app.db.select().from(domains),
    ]);

    // Runtime layers (volumes/networks/gateway) come from docker — any probe
    // failure degrades to an empty list rather than failing the whole graph.
    const volumeNames = await listManagedVolumeNames().catch(() => [] as string[]);
    const nets = await listUserNetworks().catch(() => [] as Array<{ name: string; driver: string }>);
    // Member lists are only resolved for the shared NineDeploy network —
    // inspecting every user network gets slow and the topology only needs to
    // visualise OUR mesh.
    const networks = await Promise.all(
      nets.map(async (n) => ({
        ...n,
        containers: n.name === NETWORK ? await networkMembers(n.name).catch(() => [] as string[]) : [],
      })),
    );
    const gatewayRunning = await containerRunning(TRAEFIK_CONTAINER);

    return {
      services: svcs.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        type: s.type,
        status: s.status,
        image: s.image,
        port: s.port,
        runtimeId: s.runtimeId,
        volumeMount: s.volumeMount,
      })),
      databases: dbs.map((d) => ({
        id: d.id,
        name: d.name,
        engine: d.engine,
        status: d.status,
        host: d.internalHost,
      })),
      attachments: atts.map((a) => ({ id: a.id, serviceId: a.serviceId, databaseId: a.databaseId, envAlias: a.envAlias })),
      domains: doms.map((d) => ({ id: d.id, serviceId: d.serviceId, hostname: d.hostname, ssl: d.ssl })),
      volumes: volumeNames.map((name) => {
        const owner = resolveVolumeOwner(svcs, dbs, name);
        return { name, owner: owner ? { kind: owner.kind, refId: owner.refId, name: owner.name, ...(owner.engine ? { engine: owner.engine } : {}) } : null };
      }),
      networks,
      gateway: { name: TRAEFIK_CONTAINER, network: NETWORK, running: gatewayRunning },
    };
  });
};
