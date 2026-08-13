import { NineDeployError } from '@ninedeploy/sdk';
import type { NineDeployClient } from '../client.js';
import { c, error, fmtTime, header, info, kv, spinner, statusColor, success, table } from '../lib/format.js';
import { prompt } from '../prompts.js';

/** `ninedeploy services list` */
export async function servicesList(client: NineDeployClient): Promise<void> {
  header('Services');
  await spinner('Fetching services', async () => {
    const services = await client.services.list();
    if (services.length === 0) { info('No services yet. Run `ninedeploy services create`.'); return; }
    table(
      services.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        port: s.port ?? '—',
        updated: fmtTime(s.updatedAt),
      })),
      ['id', 'name', 'type', 'status', 'port', 'updated'],
    );
  });
}

/** `ninedeploy services create` — interactive wizard */
export async function servicesCreate(client: NineDeployClient): Promise<void> {
  header('Create Service');
  console.log(c.dim('  Answer a few questions to deploy your app.\n'));

  const name = await prompt('Service name');
  if (!name) return error('Name is required');

  const mode = await prompt('Deploy from (1) Git repo  (2) Docker image', '1');
  const useRepo = mode !== '2';

  let repoUrl = '';
  let image = '';
  let branch = 'main';
  if (useRepo) {
    repoUrl = await prompt('Repository URL', '');
    if (!repoUrl) return error('Repository URL is required');
    branch = await prompt('Branch', 'main');
  } else {
    image = await prompt('Docker image (e.g. nginx:alpine)');
    if (!image) return error('Image is required');
  }

  const portStr = await prompt('Port (optional)', '');
  const port = portStr ? Number(portStr) : undefined;
  const volume = await prompt('Persistent volume path (optional)', '');

  console.log();
  try {
    const svc = await spinner('Creating service', () =>
      client.services.create({
        name, type: 'docker',
        repoUrl: useRepo ? repoUrl : undefined,
        image: useRepo ? undefined : image,
        branch, port, volumeMount: volume || undefined,
      }),
    );
    success(`Service "${svc.name}" created (id: ${svc.id})`);

    const deployNow = await prompt('Deploy now? (y/n)', 'y');
    if (deployNow.toLowerCase().startsWith('y')) {
      const res = await spinner('Deploying', () => client.deploys.trigger(svc.id));
      success(`Deployment #${res.deploymentId} queued. Check logs: ninedeploy services logs ${svc.id}`);
    }
  } catch (err) {
    error(err instanceof NineDeployError ? err.message : String(err));
  }
}

/** `ninedeploy services get <id>` */
export async function servicesGet(client: NineDeployClient, idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!id) return error('Usage: ninedeploy services get <id>');
  header('Service Details');
  await spinner('Fetching', async () => {
    const svc = await client.services.get(id);
    kv('ID', svc.id);
    kv('Name', svc.name);
    kv('Slug', svc.slug);
    kv('Type', svc.type);
    kv('Status', statusColor(svc.status));
    kv('Repo', svc.repoUrl ?? '—');
    kv('Branch', svc.branch);
    kv('Image', svc.image ?? '—');
    kv('Port', svc.port ?? '—');
    kv('Volume', svc.volumeMount ?? '—');
    kv('Health', svc.healthPath);
    kv('Runtime', svc.runtimeId ?? '—');
    kv('Commit', svc.commitSha ?? '—');
    if (svc.autoUrl) kv('URL', c.cyan(`http://${svc.autoUrl}`));
    kv('Created', fmtTime(svc.createdAt));
    kv('Updated', fmtTime(svc.updatedAt));
  });
}

/** `ninedeploy services deploy <id>` */
export async function servicesDeploy(client: NineDeployClient, idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!id) return error('Usage: ninedeploy services deploy <id>');
  try {
    const res = await spinner('Triggering deploy', () => client.deploys.trigger(id));
    success(`Deployment #${res.deploymentId} queued.`);
    info(`Watch logs: ninedeploy services logs ${id}`);
  } catch (err) { error(err instanceof Error ? err.message : String(err)); }
}

/** `ninedeploy services logs <id>` */
export async function servicesLogs(client: NineDeployClient, idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!id) return error('Usage: ninedeploy services logs <id>');
  header('Runtime Logs');
  try {
    const { lines } = await client.services.logs(id);
    if (!lines.trim()) { info('No logs yet.'); return; }
    console.log(lines.split('\n').slice(0, 50).map((l) => `  ${c.dim(l)}`).join('\n'));
  } catch (err) { error(err instanceof Error ? err.message : String(err)); }
}

/** `ninedeploy services stop|start|restart <id>` */
export async function servicesLifecycle(client: NineDeployClient, action: 'stop' | 'start' | 'restart', idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!id) return error(`Usage: ninedeploy services ${action} <id>`);
  try {
    await spinner(`${action}ing service`, () => client.services[action](id));
    success(`Service ${action}ed.`);
  } catch (err) { error(err instanceof Error ? err.message : String(err)); }
}

/** `ninedeploy services delete <id>` */
export async function servicesDelete(client: NineDeployClient, idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!id) return error('Usage: ninedeploy services delete <id>');
  const confirmText = await prompt(`Type the service ID (${id}) to confirm deletion`);
  if (confirmText !== String(id)) return error('Cancelled.');
  try {
    await spinner('Deleting service', () => client.services.remove(id));
    success('Service deleted.');
  } catch (err) { error(err instanceof Error ? err.message : String(err)); }
}

/** `ninedeploy services export <id>` */
export async function servicesExport(client: NineDeployClient, idStr: string): Promise<void> {
  const id = Number(idStr);
  if (!id) return error('Usage: ninedeploy services export <id>');
  const { writeFileSync } = await import('node:fs');
  const { loadConfig } = await import('../config.js');
  try {
    const svc = await client.services.get(id);
    const cfg = loadConfig();
    const data = await spinner('Exporting', () =>
      (async () => {
        const res = await fetch(`${cfg.baseUrl}/v1/services/${id}/export`, {
          headers: { Authorization: `Bearer ${cfg.token ?? ''}` },
        });
        return res.text();
      })(),
    );
    const filename = `${svc.slug}-export.json`;
    writeFileSync(filename, data);
    success(`Exported to ${filename}`);
  } catch (err) { error(err instanceof Error ? err.message : String(err)); }
}
