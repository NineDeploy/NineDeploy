import type { FastifyPluginAsync } from 'fastify';

/**
 * Orchestrator HTTP surface — Sprint 4, Gap G-10 (PR-A).
 *
 * Two read-only endpoints, mounted under `/v1/orchestrators`:
 *
 *   - `GET /` returns every registered orchestrator with the list
 *     of stacks the driver reports. The shape is a flat array so
 *     the panel can render a single table.
 *   - `GET /:name/stacks` returns the per-service status of one
 *     stack on the named orchestrator. Returns `null` when the
 *     orchestrator has no record of the stack.
 *
 * The orchestrator is the source of truth for the I/O. This module
 * is the source of truth for the HTTP shape. PR-B (Sprint 4 PR #19)
 * will add the `POST /:name/stacks` and `DELETE /:name/stacks/:stack`
 * write endpoints once the Swarm driver is in place; PR-A is
 * read-only because the local driver does not own a per-service
 * identity that a write path can address yet.
 */

export const orchestratorsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async () => {
    const drivers = app.kernel.registry.listOrchestrators();
    const orchestrators = await Promise.all(
      drivers.map(async (driver) => ({
        name: driver.name,
        stacks: await driver.listStacks(),
      })),
    );
    return { orchestrators };
  });

  app.get<{ Params: { name: string } }>('/:name/stacks', async (req) => {
    const driver = app.kernel.registry.getOrchestrator(req.params.name);
    if (!driver) {
      return { error: `Orchestrator "${req.params.name}" is not registered` };
    }
    const status = await driver.getStackStatus(req.params.name);
    return status;
  });
};
