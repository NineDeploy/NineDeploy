import type { databases, services } from '@ninedeploy/db';
import { capture } from './exec.js';

type ServiceRow = typeof services.$inferSelect;
type DatabaseRow = typeof databases.$inferSelect;

/** Owner reference for a managed volume, as consumed by topology/inventory views. */
export interface VolumeOwnerRef {
  kind: 'service' | 'database';
  refId: number;
  name: string;
  engine?: string;
  /** Owner's container name (service runtimeId / database container), for liveness probes. */
  containerName: string | null;
}

/** Resolve the owner (service/database) of a managed volume name — pure, no
 * docker calls, so callers that already loaded both tables can reuse it. */
export function resolveVolumeOwner(
  svcs: ServiceRow[],
  dbs: DatabaseRow[],
  name: string,
): VolumeOwnerRef | null {
  if (name.startsWith('nd-svc-')) {
    const slug = name.replace('nd-svc-', '').replace(/-data$/, '');
    const s = svcs.find((x) => x.slug === slug);
    return s ? { kind: 'service', refId: s.id, name: s.name, containerName: s.runtimeId } : null;
  }
  if (name.startsWith('nd-db-')) {
    const slug = name.replace('nd-db-', '').replace(/-data$/, '');
    const d = dbs.find((x) => x.slug === slug);
    return d ? { kind: 'database', refId: d.id, name: d.name, engine: d.engine, containerName: d.containerName } : null;
  }
  return null;
}

/** Names of NineDeploy-managed docker volumes (nd-svc- and nd-db- prefixed). */
export async function listManagedVolumeNames(): Promise<string[]> {
  const raw = await capture('docker', ['volume', 'ls', '--format', '{{.Name}}']);
  return raw
    .split('\n')
    .map((n) => n.trim())
    .filter((n) => n.startsWith('nd-svc-') || n.startsWith('nd-db-'));
}

/** User-defined docker networks (builtins like bridge/host/none excluded). */
export async function listUserNetworks(): Promise<Array<{ name: string; driver: string }>> {
  const raw = await capture('docker', ['network', 'ls', '--format', '{{.Name}}\t{{.Driver}}']);
  return raw
    .split('\n')
    .map((l) => l.trim().split('\t'))
    .filter((p) => p.length === 2 && p[0])
    .filter(([name]) => !['bridge', 'host', 'none'].includes(name!))
    .map(([name, driver]) => ({ name: name!, driver: driver! }));
}

/** Containers currently attached to a docker network. */
export async function networkMembers(network: string): Promise<string[]> {
  const raw = await capture('docker', ['network', 'inspect', network, '--format', '{{range .Containers}}{{.Name}} {{end}}']);
  return raw.split(/\s+/).filter(Boolean);
}

/** Whether a container with this exact name is running right now. Never throws —
 * a docker hiccup simply reads as "not running". */
export async function containerRunning(containerName: string | null | undefined): Promise<boolean> {
  if (!containerName) return false;
  try {
    const out = await capture('docker', ['ps', '--filter', `name=^${containerName}$`, '-q']);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
