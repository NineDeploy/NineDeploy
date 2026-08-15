import { connect } from 'node:net';

/**
 * Minimal sd_notify client (no dependencies): writes READY=1 / WATCHDOG=1 to
 * the UNIX socket named by $NOTIFY_SOCKET, as systemd expects (stream sockets
 * are supported by systemd alongside datagram ones).
 *
 * Pairs with `WatchdogSec` in the systemd unit: as long as the event loop is
 * alive we keep pinging, so a hung process is restarted by systemd within
 * ~WatchdogSec. When NOTIFY_SOCKET is absent (Docker, dev, tests) everything
 * is a no-op.
 */

const socketPath = process.env['NOTIFY_SOCKET'] ?? null;
// systemd abstract sockets are prefixed with '@' (which becomes NUL).
const addressed = socketPath ? (socketPath.startsWith('@') ? `\0${socketPath.slice(1)}` : socketPath) : null;

function send(message: string): void {
  if (!addressed) return;
  try {
    const sock = connect(addressed);
    sock.on('error', () => sock.destroy()); // notifications are best-effort
    sock.end(message);
  } catch {
    /* notifications are best-effort */
  }
}

/** Notify systemd that the service has finished starting up. */
export function notifyReady(): void {
  send(`READY=1\nSTATUS=NineDeploy listening\nMAINPID=${process.pid}`);
}

/**
 * Start watchdog pings (every intervalMs). Returns a stopper for tests /
 * graceful shutdown.
 */
export function startWatchdog(intervalMs: number): () => void {
  const timer = setInterval(() => send('WATCHDOG=1'), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
