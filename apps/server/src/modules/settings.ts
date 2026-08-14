import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { getSetting, getSettingString, setSetting, setSettingString } from '../lib/settings.js';
import { config } from '../config.js';

const togglePatch = z.object({ enabled: z.boolean() });
const emailPatch = z.object({ email: z.union([z.string().email().max(254), z.literal('')]) });

/**
 * Instance settings (admin-only). Mounted under /settings.
 * Exposes the open-registration toggle and the ACME (Let's Encrypt) email.
 */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/', async () => ({
    allowRegistration: await getSetting(app.db, 'allow_registration', true),
    // Effective email: DB setting wins, env var is the fallback.
    acmeEmail: (await getSettingString(app.db, 'acme_email', null)) ?? config.acmeEmail ?? null,
  }));

  app.put('/allow-registration', async (req) => {
    const { enabled } = togglePatch.parse(req.body);
    await setSetting(app.db, 'allow_registration', enabled);
    void audit(app.db, req.user!.id, 'settings.registration', enabled ? 'enabled' : 'disabled');
    return { ok: true, allowRegistration: enabled };
  });

  app.put('/acme-email', async (req) => {
    const { email } = emailPatch.parse(req.body);
    await setSettingString(app.db, 'acme_email', email);
    void audit(app.db, req.user!.id, 'settings.acme', email || 'cleared');
    // Applied on next server start (the Traefik container is recreated then).
    return { ok: true, acmeEmail: email || null, applied: 'restart' };
  });
};
