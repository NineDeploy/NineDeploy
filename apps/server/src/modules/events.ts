import type { FastifyPluginAsync } from 'fastify';
import { canReceiveEvent, eventBus } from '../lib/events.js';
import { resolveUser } from '../lib/auth.js';

/** Real-time event stream over WebSocket. Mounted at root level. */
export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/events', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const user = token ? await resolveUser(app.db, token) : null;
    if (!user) {
      socket.close(1008, 'unauthorized');
      return;
    }

    // Replay recent events, then stream live — both filtered to what this
    // subscriber may see. The bus is process-wide and carries every tenant's
    // activity (and, for user.*/auth.* actions, email addresses), so the
    // authorization decision belongs on delivery, not only on connect.
    for (const event of eventBus.backlog()) {
      if (!canReceiveEvent(event, user)) continue;
      try { socket.send(`${JSON.stringify(event)}\n`); } catch { /* closed */ }
    }
    const unsub = eventBus.subscribe((event) => {
      if (!canReceiveEvent(event, user)) return;
      try { socket.send(`${JSON.stringify(event)}\n`); } catch { /* closed */ }
    });
    socket.on('close', unsub);
    socket.on('error', unsub);
  });
};
