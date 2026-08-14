import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const proxyMock = vi.hoisted(() => ({
  ensureNetwork: vi.fn(async (log: (line: string) => void) => {
    log('network ready');
  }),
  ensureTraefik: vi.fn(async (log: (line: string) => void) => {
    log('traefik ready');
  }),
  writeDynamicConfig: vi.fn(async () => undefined),
  getAcmeEmail: vi.fn(async () => null),
}));

vi.mock('../../src/engine/proxy.js', () => proxyMock);

const traefikPlugin = (await import('../../src/plugins/traefik.js')).default;

async function buildApp(db: unknown) {
  const app = Fastify({ logger: false });
  app.decorate('db', db as never);
  await app.register(traefikPlugin);
  return app;
}

describe('traefik plugin', () => {
  it('ensures the network, proxy, and dynamic config on ready', async () => {
    proxyMock.ensureNetwork.mockClear();
    proxyMock.ensureTraefik.mockClear();
    proxyMock.writeDynamicConfig.mockClear();

    const db = { select: vi.fn() };
    const app = await buildApp(db);
    const infoSpy = vi.spyOn(app.log, 'info');

    await app.ready();

    expect(proxyMock.ensureNetwork).toHaveBeenCalledTimes(1);
    expect(proxyMock.ensureTraefik).toHaveBeenCalledTimes(1);
    expect(proxyMock.writeDynamicConfig).toHaveBeenCalledWith(db);
    // the plugin logs each infra step through fastify.log.info({component:'infra'}, line)
    expect(infoSpy).toHaveBeenCalledWith({ component: 'infra' }, expect.any(String));
    await app.close();
  });

  it('passes the resolved ACME email to ensureTraefik', async () => {
    proxyMock.getAcmeEmail.mockResolvedValueOnce('ops@example.com');
    proxyMock.ensureTraefik.mockClear();

    const app = await buildApp({ select: vi.fn() });
    await app.ready();

    expect(proxyMock.ensureTraefik).toHaveBeenCalledWith(expect.any(Function), 'ops@example.com');
    await app.close();
  });

  it('falls back to no ACME email when the settings read fails', async () => {
    proxyMock.getAcmeEmail.mockRejectedValueOnce(new Error('no table'));
    proxyMock.ensureTraefik.mockClear();

    const app = await buildApp({ select: vi.fn() });
    await app.ready();

    expect(proxyMock.ensureTraefik).toHaveBeenCalledWith(expect.any(Function), null);
    await app.close();
  });

  it('logs an error when writeDynamicConfig fails', async () => {
    proxyMock.writeDynamicConfig.mockRejectedValueOnce(new Error('config boom'));

    const app = await buildApp({ select: vi.fn() });
    const errorSpy = vi.spyOn(app.log, 'error');

    await app.ready();

    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'config boom' }) },
      'failed to write traefik dynamic config',
    );
    await app.close();
  });
});
