import { describe, expect, it, vi } from 'vitest';
import {
  deleteContainerPath,
  isManagedContainer,
  listContainerDir,
  makeContainerDir,
  readContainerFile,
  safeContainerPath,
  writeContainerFile,
} from '../../src/engine/containerFiles.js';

const execMocks = vi.hoisted(() => ({ capture: vi.fn(), run: vi.fn() }));
vi.mock('../../src/lib/exec.js', () => execMocks);

describe('containerFiles helpers (pure)', () => {
  it('isManagedContainer validates container identifiers', () => {
    expect(isManagedContainer('nd-svc-web-1')).toBe(true);
    expect(isManagedContainer('nd-db-postgres-1')).toBe(true);
    expect(isManagedContainer('my_container.1')).toBe(true);
    expect(isManagedContainer('-invalid')).toBe(false);
    expect(isManagedContainer('evil/escape')).toBe(false);
    expect(isManagedContainer('')).toBe(false);
    expect(isManagedContainer('a'.repeat(200))).toBe(false);
  });

  it('safeContainerPath normalises and handles paths safely', () => {
    expect(safeContainerPath('')).toBe('/');
    expect(safeContainerPath('/')).toBe('/');
    expect(safeContainerPath('/a/..')).toBe('/');
    expect(safeContainerPath('/app/data/config.json')).toBe('/app/data/config.json');
    expect(safeContainerPath('app/./data/../config.json')).toBe('/app/config.json');
    expect(safeContainerPath('/../../../etc/passwd')).toBe('/etc/passwd');
    expect(safeContainerPath('a\0b')).toBeNull();
    expect(safeContainerPath('a\nb')).toBeNull();
    expect(safeContainerPath(`/${'a'.repeat(256)}`)).toBeNull();
    expect(safeContainerPath(`/${'a'.repeat(200)}`)).toBe(`/${'a'.repeat(200)}`);
  });
});

describe('containerFiles operations (docker exec)', () => {
  it('lists directory contents with metadata (stat format)', async () => {
    execMocks.capture.mockResolvedValueOnce(
      'directory|4096|755|1786886400|./config\nregular file|1024|644|1786886401|./app.js\nsymbolic link|12|777|1786886402|./link.js\n',
    );
    const entries = await listContainerDir('nd-svc-web-1', '/app');
    expect(execMocks.capture).toHaveBeenCalledWith('docker', [
      'exec',
      'nd-svc-web-1',
      'sh',
      '-c',
      expect.stringContaining("cd '/app'"),
    ]);
    expect(entries).toEqual([
      {
        name: 'config',
        type: 'dir',
        sizeBytes: 4096,
        mode: '0755',
        modifiedAt: new Date(1786886400 * 1000).toISOString(),
      },
      {
        name: 'app.js',
        type: 'file',
        sizeBytes: 1024,
        mode: '0644',
        modifiedAt: new Date(1786886401 * 1000).toISOString(),
      },
      {
        name: 'link.js',
        type: 'file',
        sizeBytes: 12,
        mode: '0777',
        modifiedAt: new Date(1786886402 * 1000).toISOString(),
      },
    ]);
  });

  it('skips malformed output lines in listContainerDir and handles missing modes and names', async () => {
    execMocks.capture.mockResolvedValueOnce(
      'socket|0|777|0|./sock\ndirectory||||./nodirmode\ndirectory|4096|755|0|/\nregular file||||./badsize\nregular file|500||0|./nomode\n\n',
    );
    const entries = await listContainerDir('nd-svc-web-1', '/');
    expect(entries).toEqual([
      { name: 'nodirmode', type: 'dir', sizeBytes: 0, mode: null, modifiedAt: null },
      { name: 'badsize', type: 'file', sizeBytes: 0, mode: null, modifiedAt: null },
      { name: 'nomode', type: 'file', sizeBytes: 500, mode: null, modifiedAt: null },
    ]);
  });

  it('reads container file content with base64 encoding', async () => {
    execMocks.capture.mockResolvedValueOnce('ZXhwb3J0cyA9IHt9Ow==\n');
    const result = await readContainerFile('nd-svc-web-1', '/app/index.js');
    expect(result).toEqual({ content: 'ZXhwb3J0cyA9IHt9Ow==', encoding: 'base64' });
    expect(execMocks.capture).toHaveBeenCalledWith('docker', [
      'exec',
      'nd-svc-web-1',
      'sh',
      '-c',
      expect.stringContaining("tail -c 1048576 '/app/index.js'"),
    ]);
  });

  it('writes container file content via stdin', async () => {
    const logs: string[] = [];
    execMocks.run.mockResolvedValueOnce(undefined);
    await writeContainerFile('nd-svc-web-1', '/app/src/index.js', 'ZXhwb3J0cyA9IHt9Ow==', (l) => logs.push(l));
    expect(execMocks.run).toHaveBeenCalledWith(
      'docker',
      [
        'exec',
        '-i',
        'nd-svc-web-1',
        'sh',
        '-c',
        expect.stringContaining("mkdir -p '/app/src'"),
      ],
      {},
      expect.any(Function),
      Buffer.from('ZXhwb3J0cyA9IHt9Ow==', 'utf8'),
    );
  });

  it('writes root-level file with dirname fallback to /', async () => {
    execMocks.run.mockResolvedValueOnce(undefined);
    await writeContainerFile('nd-svc-web-1', '/config.json', 'e30=', () => {});
    expect(execMocks.run).toHaveBeenCalledWith(
      'docker',
      [
        'exec',
        '-i',
        'nd-svc-web-1',
        'sh',
        '-c',
        expect.stringContaining("mkdir -p '/'"),
      ],
      {},
      expect.any(Function),
      Buffer.from('e30=', 'utf8'),
    );
  });

  it('creates directory in container with mkdir -p', async () => {
    execMocks.capture.mockResolvedValueOnce('');
    await makeContainerDir('nd-svc-web-1', '/app/cache/tmp');
    expect(execMocks.capture).toHaveBeenCalledWith('docker', [
      'exec',
      'nd-svc-web-1',
      'mkdir',
      '-p',
      '--',
      '/app/cache/tmp',
    ]);
  });

  it('deletes path in container with rm -rf', async () => {
    execMocks.run.mockResolvedValueOnce(undefined);
    await deleteContainerPath('nd-svc-web-1', '/app/old.log', () => {});
    expect(execMocks.run).toHaveBeenCalledWith(
      'docker',
      ['exec', 'nd-svc-web-1', 'rm', '-rf', '--', '/app/old.log'],
      {},
      expect.any(Function),
    );
  });

  it('guards against invalid container names or paths in all functions', async () => {
    await expect(listContainerDir('invalid/name', '/')).rejects.toThrow('invalid container');
    await expect(listContainerDir('nd-svc-1', 'a\0b')).rejects.toThrow('invalid path');

    await expect(readContainerFile('invalid/name', '/app')).rejects.toThrow('invalid container');
    await expect(readContainerFile('nd-svc-1', '/')).rejects.toThrow('invalid path');
    await expect(readContainerFile('nd-svc-1', 'a\0b')).rejects.toThrow('invalid path');

    await expect(writeContainerFile('invalid/name', '/app', 'aGk=', () => {})).rejects.toThrow('invalid container');
    await expect(writeContainerFile('nd-svc-1', '/', 'aGk=', () => {})).rejects.toThrow('invalid path');
    await expect(writeContainerFile('nd-svc-1', 'a\0b', 'aGk=', () => {})).rejects.toThrow('invalid path');

    await expect(makeContainerDir('invalid/name', '/app')).rejects.toThrow('invalid container');
    await expect(makeContainerDir('nd-svc-1', '/')).rejects.toThrow('invalid path');
    await expect(makeContainerDir('nd-svc-1', 'a\0b')).rejects.toThrow('invalid path');

    await expect(deleteContainerPath('invalid/name', '/app', () => {})).rejects.toThrow('invalid container');
    await expect(deleteContainerPath('nd-svc-1', '/', () => {})).rejects.toThrow('cannot delete root');
    await expect(deleteContainerPath('nd-svc-1', 'a\0b', () => {})).rejects.toThrow('cannot delete root');
  });
});
