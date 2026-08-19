import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prompt, promptHidden } from '../src/prompts.js';

type FakeStdin = EventEmitter & {
  resume: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setEncoding: ReturnType<typeof vi.fn>;
  setRawMode?: ReturnType<typeof vi.fn>;
};

/** A fake stdin stream. `tty: true` adds setRawMode, which triggers the TTY path. */
function makeStdin(tty: boolean): FakeStdin {
  const s = new EventEmitter() as FakeStdin;
  s.resume = vi.fn();
  s.pause = vi.fn();
  s.setEncoding = vi.fn();
  if (tty) s.setRawMode = vi.fn();
  return s;
}

function stubStdin(stdin: FakeStdin) {
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as NodeJS.ReadStream);
}

let stdoutWrite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stdoutWrite = vi.fn();
  vi.spyOn(process, 'stdout', 'get').mockReturnValue({
    write: stdoutWrite,
  } as unknown as NodeJS.WriteStream);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prompt', () => {
  it('writes the message with a default hint and resolves trimmed input', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = prompt('Server URL', 'http://default');

    expect(stdoutWrite).toHaveBeenCalledWith('Server URL [http://default]: ');
    stdin.emit('data', '  http://x  \n');
    await expect(result).resolves.toBe('http://x');
  });

  it('resolves the default when the input is empty', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = prompt('Server URL', 'http://default');

    stdin.emit('data', '\r\n');
    await expect(result).resolves.toBe('http://default');
  });

  it('resolves an empty string for empty input without a default', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = prompt('Email');

    expect(stdoutWrite).toHaveBeenCalledWith('Email: ');
    stdin.emit('data', '   \n');
    await expect(result).resolves.toBe('');
  });

  it('resolves the default when stdin ends (EOF in piped/CI input)', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = prompt('Server URL', 'http://default');

    stdin.emit('end');
    await expect(result).resolves.toBe('http://default');
  });

  it('resolves an empty string on EOF without a default', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = prompt('Email');

    stdin.emit('end');
    await expect(result).resolves.toBe('');
  });
});

describe('promptHidden', () => {
  it('echoes asterisks and resolves on Enter when stdin is a TTY', async () => {
    const stdin = makeStdin(true);
    stubStdin(stdin);

    const result = promptHidden('Password');

    expect(stdoutWrite).toHaveBeenCalledWith('Password: ');
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);

    stdin.emit('data', 'ab');
    expect(stdoutWrite).toHaveBeenCalledWith('*');

    stdin.emit('data', '\r');
    await expect(result).resolves.toBe('ab');
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    expect(stdin.pause).toHaveBeenCalled();
    expect(stdoutWrite).toHaveBeenCalledWith('\n');
  });

  it('handles backspace and non-printable characters on a non-TTY stream', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = promptHidden('Password');

    expect(stdin.setRawMode).toBeUndefined();
    stdin.emit('data', 'pas\u007f'); // p, a, s, backspace
    stdin.emit('data', '\u0008'); // another backspace
    stdin.emit('data', '\u001b'); // ESC — falls through the branch chain
    stdin.emit('data', '\r');
    await expect(result).resolves.toBe('p');
    expect(stdoutWrite).toHaveBeenCalledWith('\b \b');
  });

  it('ignores backspace when there is no input yet', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = promptHidden('Password');

    stdin.emit('data', '\u007f'); // nothing to delete
    stdin.emit('data', 'x\r');
    await expect(result).resolves.toBe('x');
    expect(stdoutWrite).not.toHaveBeenCalledWith('\b \b');
  });

  it('exits with the SIGINT code 130 on Ctrl-C and restores raw mode', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stdin = makeStdin(true);
    stubStdin(stdin);

    promptHidden('Password'); // never resolves — Ctrl-C terminates instead

    stdin.emit('data', '\u0003');
    expect(exit).toHaveBeenCalledWith(130);
    // Cleanup runs before exit: raw mode is restored and the stream paused.
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    expect(stdin.pause).toHaveBeenCalled();
  });

  it('resolves typed input on EOF (piped stdin)', async () => {
    const stdin = makeStdin(false);
    stubStdin(stdin);

    const result = promptHidden('Password');

    stdin.emit('data', 'secret');
    stdin.emit('end');
    await expect(result).resolves.toBe('secret');
  });
});
