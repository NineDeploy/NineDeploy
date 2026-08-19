import process from 'node:process';

/** Read a single line from stdin with normal echo. Honors an optional default. */
export function prompt(message: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      const value = String(chunk).replace(/\r?\n$/, '').trim();
      resolve(value.length ? value : (defaultValue ?? ''));
    };
    // EOF (piped stdin in CI): resolve with the default / empty instead of
    // hanging forever waiting for input that will never arrive.
    const onEnd = () => {
      process.stdin.off('data', onData);
      resolve(defaultValue ?? '');
    };
    process.stdin.once('data', onData);
    process.stdin.once('end', onEnd);
  });
}

/** Read a single line from stdin without echoing (for passwords / secrets). */
export function promptHidden(message: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const isTTY = typeof stdin.setRawMode === 'function';
    process.stdout.write(`${message}: `);
    if (isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let data = '';
    const cleanup = () => {
      if (isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdin.off('end', onEnd);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) {
          // Enter
          cleanup();
          process.stdout.write('\n');
          resolve(data);
          return;
        } else if (code === 3) {
          // Ctrl-C: standard "interrupted" exit code (130 = 128 + SIGINT),
          // and let cleanup run so raw mode is restored before exiting.
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        } else if (code === 127 || code === 8) {
          // Backspace
          if (data.length > 0) {
            data = data.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (code >= 32 && code !== 127) {
          data += ch;
          process.stdout.write('*');
        }
      }
    };
    // EOF (piped stdin): resolve with whatever was typed so far.
    const onEnd = () => {
      cleanup();
      process.stdout.write('\n');
      resolve(data);
    };
    stdin.on('data', onData);
    stdin.once('end', onEnd);
  });
}
