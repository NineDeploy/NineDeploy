import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
// ws client (transitive dep of @fastify/websocket) — needed for `.terminate()`,
// which abruptly destroys the connection and triggers the server socket error.
import { WebSocket as WsClient } from '../../../node_modules/.pnpm/ws@8.21.3/node_modules/ws';
import { logBus } from '../src/engine/logs.js';
import { deploysRoutes } from '../src/modules/deploys.js';
import { asUser, buildTestApp, collectMessages, createFakeDb, depRow, listen, openWs, svcRow, waitFor, wsUrl } from './helpers.js';

const authMocks = vi.hoisted(() => ({
  resolveUser: vi.fn(async (_db: unknown, token: string) => (token === 'valid' ? { id: 1 } : null)),
}));
vi.mock('../src/lib/auth.js', () => authMocks);

const childProc = vi.hoisted(() => {
  const makeEmitter = () => {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    return {
      on: (ev: string, cb: (...a: unknown[]) => void) => {
        (handlers[ev] ??= []).push(cb);
      },
      emit: (ev: string, ...a: unknown[]) => {
        for (const cb of handlers[ev] ?? []) cb(...a);
      },
    };
  };
  const children: Array<ReturnType<typeof makeFakeChild>> = [];
  function makeFakeChild() {
    const emitter = makeEmitter();
    const child = {
      stdin: { write: vi.fn() },
      stdout: makeEmitter(),
      stderr: makeEmitter(),
      killed: false,
      kill: vi.fn(),
      on: emitter.on,
      emit: emitter.emit,
    };
    child.kill = vi.fn(() => { child.killed = true; });
    children.push(child);
    return child;
  }
  const spawn = vi.fn(() => makeFakeChild());
  return { spawn, children };
});
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => childProc.spawn(...a) }));

const sockets: WebSocket[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  childProc.children.length = 0;
});

describe('deploys routes', () => {
  afterAll(async () => {
    for (const ws of sockets) {
      try { ws.close(); } catch { /* already closed */ }
    }
  });

  it('queues a deployment for a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { services: svcRow({ id: 1, name: 'web' }) },
        insert: { deployments: [depRow({ id: 9, status: 'queued' })] },
      }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'POST', url: '/services/1/deploys', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deploymentId: 9 });
  });

  it('returns 404 when deploying a missing service', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'POST', url: '/services/99/deploys', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('lists deployments for a service', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findMany: {
          deployments: [
            depRow({ id: 1, startedAt: new Date('2026-01-01T00:01:00Z'), finishedAt: new Date('2026-01-01T00:02:00Z') }),
            depRow({ id: 2, commitSha: null, startedAt: null, finishedAt: null, message: null, author: null }),
          ],
        },
      }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'GET', url: '/services/1/deploys', headers: asUser() });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows[0]).toMatchObject({
      id: 1,
      status: 'running',
      commitSha: 'abcdef1',
      startedAt: '2026-01-01T00:01:00.000Z',
      finishedAt: '2026-01-01T00:02:00.000Z',
    });
    expect(rows[1]).toMatchObject({ id: 2, commitSha: null, startedAt: null, finishedAt: null, message: null });
  });

  it('rolls back to a previous deployment', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { deployments: depRow({ id: 9, serviceId: 1, commitSha: 'oldsha' }) },
        insert: { deployments: [depRow({ id: 10, status: 'queued' })] },
      }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'POST', url: '/services/1/deploys/9/rollback', headers: asUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deploymentId: 10 });
  });

  it('rolls back to a deployment without a commit sha', async () => {
    const app = await buildTestApp({
      db: createFakeDb({
        findFirst: { deployments: depRow({ id: 9, serviceId: 1, commitSha: null }) },
        insert: { deployments: [depRow({ id: 10, status: 'queued' })] },
      }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'POST', url: '/services/1/deploys/9/rollback', headers: asUser() });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when the rollback target is missing', async () => {
    const app = await buildTestApp({ db: createFakeDb() });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'POST', url: '/services/1/deploys/99/rollback', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when rolling back across services', async () => {
    const app = await buildTestApp({
      db: createFakeDb({ findFirst: { deployments: depRow({ id: 9, serviceId: 1 }) } }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const res = await app.inject({ method: 'POST', url: '/services/2/deploys/9/rollback', headers: asUser() });
    expect(res.statusCode).toBe(404);
  });

  it('streams the log backlog and live lines over websocket', async () => {
    logBus.publish(5, 'backlog line');
    const app = await buildTestApp({ websocket: true, db: createFakeDb() });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = await openWs(wsUrl(port, '/services/1/deploys/5/logs?token=valid'));
    sockets.push(ws);
    const messages = collectMessages(ws);
    await waitFor(() => messages.length > 0);
    expect(messages[0]).toContain('backlog line');

    logBus.publish(5, 'live line');
    await waitFor(() => messages.some((m) => m.includes('live line')));
    ws.close();
    await app.close();
  });

  it('closes the log socket when the token is invalid', async () => {
    const app = await buildTestApp({ websocket: true, db: createFakeDb() });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = await openWs(wsUrl(port, '/services/1/deploys/5/logs?token=bad'));
    sockets.push(ws);
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (ev) => resolve(ev.code)));
    expect(await closed).toBe(1008);
    await app.close();
  });

  it('opens the log socket without a backlog', async () => {
    const app = await buildTestApp({ websocket: true, db: createFakeDb() });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = await openWs(wsUrl(port, '/services/9/deploys/99/logs?token=valid'));
    sockets.push(ws);
    const messages = collectMessages(ws);
    // No log file exists for deployment 99 → no backlog replay.
    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toEqual([]);
    ws.close();
    await app.close();
  });

  it('opens a container exec terminal over websocket', async () => {
    const app = await buildTestApp({
      websocket: true,
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = await openWs(wsUrl(port, '/services/1/exec?token=valid'));
    sockets.push(ws);
    const messages = collectMessages(ws);
    await waitFor(() => childProc.children.length === 1);
    const child = childProc.children[0];
    expect(childProc.spawn).toHaveBeenCalledWith('docker', ['exec', '-i', 'c1', 'sh'], {});

    child.stdout.emit('data', 'hello from container');
    await waitFor(() => messages.some((m) => m.includes('hello from container')));
    child.stderr.emit('data', 'warn');
    await waitFor(() => messages.some((m) => m.includes('warn')));

    ws.send('echo hi');
    await waitFor(() => (child.stdin.write as ReturnType<typeof vi.fn>).mock.calls.length > 0);

    const closed = new Promise<void>((resolve) => ws.addEventListener('close', () => resolve()));
    child.emit('exit');
    await closed;
    child.emit('close');
    await waitFor(() => (child.kill as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    ws.close();
    await app.close();
  });

  it('closes the exec socket for a missing runtime', async () => {
    const app = await buildTestApp({
      websocket: true,
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: null }) } }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = await openWs(wsUrl(port, '/services/1/exec?token=valid'));
    sockets.push(ws);
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (ev) => resolve(ev.code)));
    expect(await closed).toBe(1008);
    await app.close();
  });

  it('closes the exec socket when unauthorized', async () => {
    const app = await buildTestApp({ websocket: true, db: createFakeDb() });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = await openWs(wsUrl(port, '/services/1/exec'));
    sockets.push(ws);
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (ev) => resolve(ev.code)));
    expect(await closed).toBe(1008);
    await app.close();
  });

  it('kills the child when the exec socket errors', async () => {
    const app = await buildTestApp({
      websocket: true,
      db: createFakeDb({ findFirst: { services: svcRow({ id: 1, runtimeId: 'c1' }) } }),
    });
    await app.register(deploysRoutes, { prefix: '/services' });
    const port = await listen(app);
    const ws = new WsClient(wsUrl(port, '/services/1/exec?token=valid'));
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    sockets.push(ws as unknown as WebSocket);
    await waitFor(() => childProc.children.length === 1);
    // Write an invalid WebSocket frame (reserved opcode) → protocol error on
    // the server socket → its 'error' handler runs child.kill().
    (ws as unknown as { _socket: { write: (b: Buffer) => void } })._socket.write(
      Buffer.from([0x0f, 0x80, 0x00, 0x00]),
    );
    await waitFor(() => (childProc.children[0].kill as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    await app.close();
  });
});
