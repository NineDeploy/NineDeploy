import { and, eq } from 'drizzle-orm';
import { audit } from "../lib/audit.js";
import { domains, services, type Domain } from '@ninedeploy/db';
import type { FastifyPluginAsync } from 'fastify';
import { createDomain, domainPatch } from '@ninedeploy/schemas';
import { parseHeaders, writeDynamicConfig } from '../engine/proxy.js';
import { createDnsRecord, deleteDnsRecord, detectPublicIp, getDnsRecordsConfig } from '../lib/cloudflare.js';
import { conflict, notFound, parseId as num } from '../lib/errors.js';

function serialize(d: Domain) {
  return {
    id: d.id,
    serviceId: d.serviceId,
    hostname: d.hostname,
    path: d.path,
    ssl: d.ssl,
    redirectWww: d.redirectWww,
    headers: d.headers ?? '[]',
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
        redirectWww: input.redirectWww ?? false,
        headers: input.headers ?? null,
        status: 'active',
      })
      .returning()
      .catch(() => [] as Domain[]);
    if (!d) throw conflict('A domain with that host already exists');
    // Cloudflare integration: create the DNS record for this hostname. The
    // domain is already usable (manual DNS); a provider failure is surfaced as
    // a flag on the response rather than failing the request.
    let dnsWarning: string | null = null;
    let dnsRecordId: string | null = null;
    const dnsCfg = await getDnsRecordsConfig(app.db);
    if (dnsCfg.enabled && dnsCfg.token) {
      try {
        const content = dnsCfg.content || (await detectPublicIp());
        dnsRecordId = await createDnsRecord(dnsCfg.token, input.hostname, content);
        await app.db.update(domains).set({ dnsRecordId }).where(eq(domains.id, d.id));
      } catch (err) {
        dnsWarning = err instanceof Error ? err.message : String(err);
      }
    }
    await writeDynamicConfig(app.db);
    void audit(
      app.db,
      req.user!.id,
      'domain.add',
      input.hostname,
      dnsRecordId ? { dnsRecordId } : dnsWarning ? { dnsWarning } : undefined,
    );
    return { ...serialize(d), dnsRecordId, dnsWarning };
  });

  // Update routing extras: ssl, www→apex redirect and custom response headers.
  app.patch('/:id/domains/:domainId', async (req) => {
    const id = num((req.params as { id: string }).id);
    const domainId = num((req.params as { domainId: string }).domainId);
    const input = domainPatch.parse(req.body ?? {});
    // Validate early so a malformed headers array never reaches Traefik.
    const values: Partial<typeof domains.$inferInsert> = {};
    if (input.ssl !== undefined) values.ssl = input.ssl;
    if (input.redirectWww !== undefined) values.redirectWww = input.redirectWww;
    if (input.headers !== undefined) {
      const parsed = parseHeaders(input.headers);
      values.headers = JSON.stringify(parsed);
    }
    const [d] = await app.db
      .update(domains)
      .set(values)
      .where(and(eq(domains.id, domainId), eq(domains.serviceId, id)))
      .returning();
    if (!d) throw notFound('Domain not found');
    await writeDynamicConfig(app.db);
    void audit(app.db, req.user!.id, 'domain.update', d.hostname);
    return serialize(d);
  });

  app.delete('/:id/domains/:domainId', async (req) => {
    const id = num((req.params as { id: string }).id);
    const domainId = num((req.params as { domainId: string }).domainId);
    const existing = await app.db.query.domains.findFirst({
      where: and(eq(domains.id, domainId), eq(domains.serviceId, id)),
    });
    await app.db.delete(domains).where(and(eq(domains.id, domainId), eq(domains.serviceId, id)));
    // Remove the provider DNS record (best-effort — a stale record only points
    // at the server, it no longer routes anywhere once Traefik rewrites).
    if (existing?.dnsRecordId) {
      const dnsCfg = await getDnsRecordsConfig(app.db);
      if (dnsCfg.enabled && dnsCfg.token) {
        await deleteDnsRecord(dnsCfg.token, existing.hostname, existing.dnsRecordId).catch(() => undefined);
      }
    }
    await writeDynamicConfig(app.db);
    void audit(app.db, req.user!.id, 'domain.delete', existing?.hostname ?? `#${domainId}`);
    return { ok: true };
  });
};
