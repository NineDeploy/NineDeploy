import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  buildApp: vi.fn(),
  exitCalls: [] as number[],
  signalListeners: {} as Record<string, () => void>,
}));

vi.mock('../src/app.js', () => ({ buildApp: state.buildApp }));
vi.mock('../src/lib/sdNotify.js', () => ({
  notifyReady: vi.fn(),
  startWatchdog: vi.fn(() => () => undefined),
}));

interface FakeApp {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  log: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  register: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function fakeApp(): FakeApp {
  return {
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    log: { info: vi.fn(), error: vi.fn() },
    register: vi.fn(async () => undefined),
    post: vi.fn(),
    get: vi.fn(),
  };
}

let _exitSpy: ReturnType<typeof vi.spyOn>;
let _onSpy: ReturnType<typeof vi.spyOn>;
let _logSpy: ReturnType<typeof vi.spyOn>;
let envAgent: string | undefined;
let envToken: string | undefined;
let envPort: string | undefined;

beforeEach(() => {
  state.exitCalls = [];
  state.signalListeners = {};
  state.buildApp.mockReset();
  _exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    state.exitCalls.push(code ?? 0);
    return undefined as never;
  }) as never);
  _onSpy = vi.spyOn(process, 'on').mockImplementation((((event: string, listener: () => void) => {
    state.signalListeners[event] = listener;
    return process;
  }) as never) as never);
  _logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  envAgent = process.env['NINEDEPLOY_AGENT'];
  envToken = process.env['NINEDEPLOY_AGENT_TOKEN'];
  envPort = process.env['NINEDEPLOY_AGENT_PORT'];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (envAgent === undefined) delete process.env['NINEDEPLOY_AGENT'];
  else process.env['NINEDEPLOY_AGENT'] = envAgent;
  if (envToken === undefined) delete process.env['NINEDEPLOY_AGENT_TOKEN'];
  else process.env['NINEDEPLOY_AGENT_TOKEN'] = envToken;
  if (envPort === undefined) delete process.env['NINEDEPLOY_AGENT_PORT'];
  else process.env['NINEDEPLOY_AGENT_PORT'] = envPort;
});

async function importAgent() {
  vi.resetModules();
  process.env['NINEDEPLOY_AGENT'] = '1';
  await import('../src/agent.js');
}

describe('agent bootstrap', () => {
  it('exits without a token hash', async () => {
    delete process.env['NINEDEPLOY_AGENT_TOKEN'];
    // process.exit is mocked (doesn't halt), so main would continue — give it
    // a fake app to register against so the run stays clean.
    state.buildApp.mockResolvedValue(fakeApp());
    await importAgent();
    expect(state.exitCalls).toContain(1);
  });

  it('boots, listens on the agent port and shuts down on SIGTERM', async () => {
    process.env['NINEDEPLOY_AGENT_TOKEN'] = 'a'.repeat(64);
    process.env['NINEDEPLOY_AGENT_PORT'] = '4699';
    const app = fakeApp();
    state.buildApp.mockResolvedValue(app);
    await importAgent();
    await vi.waitFor(() => expect(app.listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 4699 }));
    expect(app.register).toHaveBeenCalledWith(expect.anything(), { tokenHash: 'a'.repeat(64) });
    // SIGTERM → graceful close.
    state.signalListeners['SIGTERM']!();
    await vi.waitFor(() => expect(app.close).toHaveBeenCalled());
    expect(state.exitCalls).toContain(0);
  });

  it('does not boot when the agent flag is absent', async () => {
    const app = fakeApp();
    state.buildApp.mockResolvedValue(app);
    vi.resetModules();
    delete process.env['NINEDEPLOY_AGENT'];
    await import('../src/agent.js');
    expect(app.listen).not.toHaveBeenCalled();
  });
});
