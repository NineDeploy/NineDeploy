import type { FastifyPluginAsync } from 'fastify';
import { eventBus } from '../lib/events.js';
import { resolveUser } from '../lib/auth.js';

/** Real-time event stream over WebSocket. Mounted at root level. */
export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/events', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token || !(await resolveUser(app.db, token))) {
      socket.close(1008, 'unauthorized');
      return;
    }

    // Replay recent events, then stream live.
    for (const event of eventBus.backlog()) {
      try { socket.send(`${JSON.stringify(event)}\n`); } catch { /* closed */ }
    }
    const unsub = eventBus.subscribe((event) => {
      try { socket.send(`${JSON.stringify(event)}\n`); } catch { /* closed */ }
    });
    socket.on('close', unsub);
    socket.on('error', unsub);
  });
};
