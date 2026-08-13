import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupAction } from '../src/commands/setup.js';

const h = vi.hoisted(() => {
  class NineDeployError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    NineDeployError,
    createClient: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    prompt: vi.fn(),
    promptHidden: vi.fn(),
  };
});

vi.mock('@ninedeploy/sdk', () => ({
  createClient: h.createClient,
  NineDeployError: h.NineDeployError,
}));
vi.mock('../src/config.js', () => ({ loadConfig: h.loadConfig, saveConfig: h.saveConfig }));
vi.mock('../src/prompts.js', () => ({ prompt: h.prompt, promptHidden: h.promptHidden }));

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.loadConfig.mockReturnValue({ baseUrl: 'http://default:3000' });
  h.prompt
    .mockResolvedValueOnce('http://srv:3000')
    .mockResolvedValueOnce('admin@x.io')
    .mockResolvedValueOnce('Ada');
  h.promptHidden.mockResolvedValue('secret-pass');
  h.createClient.mockReturnValue({ auth: { setup: vi.fn() } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupAction', () => {
  it('registers the admin and stores the token', async () => {
    const setup = vi.fn().mockResolvedValue({
      tokens: { accessToken: 'tok123' },
      user: { email: 'admin@x.io', role: 'admin' },
    });
    h.createClient.mockReturnValue({ auth: { setup } });

    await setupAction();

    expect(h.prompt).toHaveBeenNthCalledWith(1, 'Server URL', 'http://default:3000');
    expect(h.prompt).toHaveBeenNthCalledWith(2, 'Admin email');
    expect(h.prompt).toHaveBeenNthCalledWith(3, 'Display name (optional)');
    expect(h.promptHidden).toHaveBeenCalledWith('Password (min 8 chars)');
    expect(setup).toHaveBeenCalledWith({ email: 'admin@x.io', password: 'secret-pass', name: 'Ada' });
    expect(h.saveConfig).toHaveBeenCalledWith({ baseUrl: 'http://srv:3000', token: 'tok123' });
    expect(logSpy).toHaveBeenCalledWith('✓ Admin account created: admin@x.io');
    expect(logSpy).toHaveBeenCalledWith('  Credentials saved — you are logged in.');
    expect(process.exitCode).toBe(0);
  });

  it('omits the display name when not provided', async () => {
    const setup = vi.fn().mockResolvedValue({
      tokens: { accessToken: 't' },
      user: { email: 'admin@x.io', role: 'admin' },
    });
    h.createClient.mockReturnValue({ auth: { setup } });
    h.prompt.mockReset().mockResolvedValueOnce('http://srv:3000').mockResolvedValueOnce('admin@x.io').mockResolvedValueOnce('');

    await setupAction();

    expect(setup).toHaveBeenCalledWith({ email: 'admin@x.io', password: 'secret-pass', name: undefined });
  });

  it('rejects an empty email', async () => {
    h.prompt.mockReset().mockResolvedValueOnce('http://srv:3000').mockResolvedValueOnce('').mockResolvedValueOnce('Ada');

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('Email is required.');
    expect(process.exitCode).toBe(1);
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  it('rejects an empty password', async () => {
    h.promptHidden.mockResolvedValue('');

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('Password must be at least 8 characters.');
    expect(process.exitCode).toBe(1);
  });

  it('rejects a too-short password', async () => {
    h.promptHidden.mockResolvedValue('short');

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('Password must be at least 8 characters.');
    expect(process.exitCode).toBe(1);
  });

  it('prints the 409 hint when the instance already has an admin', async () => {
    const setup = vi.fn().mockRejectedValue(new h.NineDeployError(409, 'admin already exists'));
    h.createClient.mockReturnValue({ auth: { setup } });

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Setup failed (409): admin already exists');
    expect(errorSpy).toHaveBeenCalledWith('  The instance already has an admin user.');
    expect(process.exitCode).toBe(1);
  });

  it('prints a server error without the hint for other statuses', async () => {
    const setup = vi.fn().mockRejectedValue(new h.NineDeployError(500, 'boom'));
    h.createClient.mockReturnValue({ auth: { setup } });

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Setup failed (500): boom');
    expect(errorSpy).not.toHaveBeenCalledWith('  The instance already has an admin user.');
    expect(process.exitCode).toBe(1);
  });

  it('prints the message for a generic Error', async () => {
    const setup = vi.fn().mockRejectedValue(new Error('network down'));
    h.createClient.mockReturnValue({ auth: { setup } });

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Setup failed:', 'network down');
    expect(process.exitCode).toBe(1);
  });

  it('prints the raw value for a non-Error rejection', async () => {
    const setup = vi.fn().mockRejectedValue('boom');
    h.createClient.mockReturnValue({ auth: { setup } });

    await setupAction();

    expect(errorSpy).toHaveBeenCalledWith('✗ Setup failed:', 'boom');
    expect(process.exitCode).toBe(1);
  });
});
