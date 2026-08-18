import { capture, run } from '../lib/exec.js';

export interface ContainerFileEntry {
  name: string;
  type: 'file' | 'dir';
  sizeBytes: number;
  mode?: string | null;
  modifiedAt: string | null;
}

/** Validate container identifier. */
export function isManagedContainer(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(name);
}

/** Choke-point guard: every container operation below must go through this. */
function assertManagedContainer(container: string): void {
  if (!isManagedContainer(container)) {
    throw new Error(`Refusing to operate on invalid container: ${container}`);
  }
}

/** Normalise a user-supplied path into a clean absolute container path (default '/'). */
export function safeContainerPath(input: string): string | null {
  if (input.includes('\0') || input.includes('\n')) return null;
  const raw = input.trim();
  if (!raw || raw === '/') return '/';
  const parts: string[] = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 0) parts.pop();
      continue;
    }
    if (seg.length > 255) return null;
    parts.push(seg);
  }
  return parts.length ? '/' + parts.join('/') : '/';
}

function toIso(mtime: string | undefined): string | null {
  const secs = Number(mtime);
  return Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString() : null;
}

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

/** List a directory inside a running container. */
export async function listContainerDir(container: string, path: string): Promise<ContainerFileEntry[]> {
  assertManagedContainer(container);
  const target = safeContainerPath(path);
  if (!target) throw new Error('invalid path');

  const out = await capture('docker', [
    'exec',
    container,
    'sh',
    '-c',
    `cd ${shellQuote(target)} 2>/dev/null && find . -mindepth 1 -maxdepth 1 -exec stat -c '%F|%s|%a|%Y|%n' {} + 2>/dev/null | sort`,
  ]);

  const entries: ContainerFileEntry[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [type, size, mode, mtime, ...nameParts] = line.split('|');
    const name = nameParts.join('|').split('/').pop()!.trim();
    if (!name) continue;
    if (type === 'directory') {
      entries.push({
        name,
        type: 'dir',
        sizeBytes: Number(size) || 0,
        mode: mode ? `0${mode}` : null,
        modifiedAt: toIso(mtime),
      });
    } else if (type === 'regular file' || type === 'symbolic link') {
      entries.push({
        name,
        type: 'file',
        sizeBytes: Number(size) || 0,
        mode: mode ? `0${mode}` : null,
        modifiedAt: toIso(mtime),
      });
    }
  }
  return entries;
}

/** Read a file (base64 encoded) out of the container with a 1MB safety cap. */
export async function readContainerFile(
  container: string,
  path: string,
): Promise<{ content: string; encoding: 'utf8' | 'base64' }> {
  assertManagedContainer(container);
  const target = safeContainerPath(path);
  if (!target || target === '/') throw new Error('invalid path');

  const out = await capture('docker', [
    'exec',
    container,
    'sh',
    '-c',
    `test -f ${shellQuote(target)} && tail -c 1048576 ${shellQuote(target)} | base64`,
  ]);
  return { content: out.trim(), encoding: 'base64' };
}

/** Write (overwrite) a file inside the container with base64 content. */
export async function writeContainerFile(
  container: string,
  path: string,
  base64: string,
  sink: (line: string) => void,
): Promise<void> {
  assertManagedContainer(container);
  const target = safeContainerPath(path);
  if (!target || target === '/') throw new Error('invalid path');

  await run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'sh',
      '-c',
      `mkdir -p ${shellQuote(dirname(target))} && base64 -d > ${shellQuote(target)}`,
    ],
    {},
    sink,
    Buffer.from(base64, 'utf8'),
  );
}

/** Create a directory inside the container. */
export async function makeContainerDir(container: string, path: string): Promise<void> {
  assertManagedContainer(container);
  const target = safeContainerPath(path);
  if (!target || target === '/') throw new Error('invalid path');

  await capture('docker', ['exec', container, 'mkdir', '-p', '--', target]);
}

/** Delete a file or directory inside the container. */
export async function deleteContainerPath(
  container: string,
  path: string,
  sink: (line: string) => void,
): Promise<void> {
  assertManagedContainer(container);
  const target = safeContainerPath(path);
  if (!target || target === '/') throw new Error('cannot delete root');

  await run('docker', ['exec', container, 'rm', '-rf', '--', target], {}, sink);
}
