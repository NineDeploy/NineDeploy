import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { getSetting, setSetting } from '../lib/settings.js';

const togglePatch = z.object({ enabled: z.boolean() });

/**
 * Instance settings (admin-only). Mounted under /settings.
 * Currently exposes the open-registration toggle; further flags land here.
 */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => ({
    allowRegistration: await getSetting(app.db, 'allow_registration', true),
  }));

  app.put('/allow-registration', async (req) => {
    const { enabled } = togglePatch.parse(req.body);
    await setSetting(app.db, 'allow_registration', enabled);
    void audit(app.db, req.user!.id, 'settings.registration', enabled ? 'enabled' : 'disabled');
    return { ok: true, allowRegistration: enabled };
  });
};
