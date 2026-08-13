import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { config } from '../config.js';
import { capture } from './exec.js';

export interface ContainerStat {
  name: string;
  cpuPct: number; // e.g. 0.42 means 0.42%
  memBytes: number;
  memLimitBytes: number;
}

export interface HostStat {
  cpuCores: number;
  load1: number;
  memTotalBytes: number;
  memUsedBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
}

/** Parse human sizes like "12.34MiB", "1.5GiB", "977kB" into bytes. */
function parseBytes(input: string): number {
  const m = /^([\d.]+)\s*([A-Za-z]+)?$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const u = (m[2] ?? 'b').toLowerCase();
  const mult =
    u === 'b'
      ? 1
      : u === 'kb' || u === 'kib'
        ? 1024
        : u === 'mb' || u === 'mib'
          ? 1024 ** 2
          : u === 'gb' || u === 'gib'
            ? 1024 ** 3
            : u === 'tb' || u === 'tib'
              ? 1024 ** 4
              : 1;
  return n * mult;
}

/** Collect current CPU/memory for every running container via `docker stats`. */
export async function collectContainerStats(): Promise<Map<string, ContainerStat>> {
  const out = new Map<string, ContainerStat>();
  let raw = '';
  try {
    raw = await capture('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}',
    ]);
  } catch {
    return out;
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [name, cpu, mem] = line.split('|');
    if (!name) continue;
    const [used, limit] = (mem ?? ' / ').split('/');
    out.set(name.trim(), {
      name: name.trim(),
      cpuPct: Number((cpu ?? '0').replace('%', '').trim()) || 0,
      memBytes: parseBytes(used!),
      memLimitBytes: parseBytes(limit ?? ''),
    });
  }
  return out;
}

async function diskFor(dir: string): Promise<{ total: number; used: number }> {
  try {
    const out = await capture('df', ['-k', dir]);
    const line = out.trim().split('\n')[1];
    const parts = line?.split(/\s+/);
    if (parts && parts.length >= 3) return { total: Number(parts[1]) * 1024, used: Number(parts[2]) * 1024 };
  } catch {
    /* df unavailable */
  }
  return { total: 0, used: 0 };
}

/** Collect host-level resource usage. */
export async function collectHostStats(): Promise<HostStat> {
  const memTotal = totalmem();
  const disk = await diskFor(config.paths.dataDir);
  return {
    cpuCores: cpus().length,
    load1: loadavg()[0] ?? 0,
    memTotalBytes: memTotal,
    memUsedBytes: memTotal - freemem(),
    diskTotalBytes: disk.total,
    diskUsedBytes: disk.used,
  };
}
