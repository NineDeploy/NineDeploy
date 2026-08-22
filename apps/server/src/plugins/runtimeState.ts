import fp from 'fastify-plugin';
import { and, eq, isNull } from 'drizzle-orm';
import { services } from '@ninedeploy/db';
import { pm2Status } from '../engine/builders/pm2.js';
import { capture } from '../lib/exec.js';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Runtime-state reconciliation. `services.status` stores the last lifecycle
 * result, not live truth: after a reboot, a daemon outage, or an external
 * `docker stop`, rows still claim 'running' while nothing runs — exactly when
 * an operator most needs an accurate panel. This watchdog walks local services
 * whose DB status is 'running', asks the actual runtime, and DOWNS the row to
 * match reality ('stopped' when the runtime exists but is not running,
 * 'error' when the runtime is gone and only a redeploy can bring it back).
 * It never upgrades a status and never touches non-running rows (a deploy in
 * progress) or services owned by remote agents.
 */

/** The daemon cannot be reached at all — reconciliation must skip, not judge. */
class DaemonUnavailableError extends Error {}

async function containerState(runtimeId: string): Promise<'running' | 'stopped' | 'gone'> {
  try {
    const state = (
      await capture('docker', ['inspect', '--format', '{{.State.Status}}', runtimeId])
    ).trim();
    // 'restarting' is on its way back up — treat as running, not as a downgrade.
    if (state === 'running' || state === 'restarting') return 'running';
    // exited/created/paused/dead: the container exists but is not serving.
    return 'stopped';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cannot connect to the docker daemon|docker daemon is not running|error during connect/i.test(msg)) {
      throw new DaemonUnavailableError(msg);
    }
    // "No such container/object" — the runtime was destroyed.
    return 'gone';
  }
}

export default fp(
  async (fastify) => {
    const downgrade = async (
      svc: { id: number; name: string; runtimeId: string | null },
      status: 'stopped' | 'error',
    ) => {
      await fastify.db
        .update(services)
        .set({ status })
        .where(eq(services.id, svc.id));
      fastify.log.warn(
        { serviceId: svc.id, name: svc.name, runtimeId: svc.runtimeId, status },
        'service runtime is not running; status reconciled from live state',
      );
    };

    const reconcile = async () => {
      try {
        const rows = await fastify.db.query.services.findMany({
          where: and(eq(services.status, 'running'), isNull(services.serverId)),
        });
        let daemonDown = false;
        for (const svc of rows) {
          if (!svc.runtimeId) continue;
          try {
            if (svc.type === 'pm2') {
              const live = await pm2Status(svc.runtimeId);
              if (live === 'online') continue;
              await downgrade(svc, live === 'stopped' ? 'stopped' : 'error');
            } else if (svc.type === 'docker' || svc.type === 'compose') {
              if (daemonDown) continue;
              const live = await containerState(svc.runtimeId);
              if (live === 'running') continue;
              await downgrade(svc, live === 'stopped' ? 'stopped' : 'error');
            }
          } catch (err) {
            if (err instanceof DaemonUnavailableError) {
              daemonDown = true;
              fastify.log.debug('docker daemon unreachable; skipping runtime reconciliation this round');
              continue;
            }
            fastify.log.warn({ err, serviceId: svc.id }, 'runtime state check failed');
          }
        }
      } catch (err) {
        fastify.log.warn({ err }, 'runtime state reconciliation failed');
      }
    };

    // Fire-and-forget on boot: reconcile must not delay readiness, and the
    // rows it inspects are by definition not mid-deploy (status = 'running').
    fastify.addHook('onReady', () => {
      void reconcile();
    });

    const timer = setInterval(() => {
      void reconcile();
    }, RECONCILE_INTERVAL_MS);
    timer.unref();

    fastify.addHook('onClose', () => {
      clearInterval(timer);
    });
  },
  { name: 'ninedeploy-runtime-state' },
);
