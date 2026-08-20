import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const registry = JSON.parse(await readFile(new URL('../apps/server/src/templates/registry.json', import.meta.url), 'utf8'));
const requested = process.argv.find((arg) => arg.startsWith('--ids='))?.slice('--ids='.length).split(',').filter(Boolean) ?? [];
const timeoutSeconds = Number(process.argv.find((arg) => arg.startsWith('--timeout='))?.slice('--timeout='.length) ?? 300);
if (requested.length === 0) {
  process.stderr.write('Usage: node scripts/smoke-template-runtime.mjs --ids=n8n,gitea [--timeout=300]\n');
  process.exit(2);
}

const byId = new Map(registry.templates.map((template) => [template.id, template]));
const unknown = requested.filter((id) => !byId.has(id));
if (unknown.length > 0) throw new Error(`Unknown template IDs: ${unknown.join(', ')}`);
const unsupported = requested.filter((id) => byId.get(id).dbEngine || byId.get(id).dockerSocket);
if (unsupported.length > 0) {
  throw new Error(`Database/socket templates need their dedicated smoke profile: ${unsupported.join(', ')}`);
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const network = `nd-template-smoke-${suffix}`;
const createdContainers = [];
const createdVolumes = [];

async function docker(args, options = {}) {
  return exec('docker', args, { timeout: options.timeout ?? 120_000, maxBuffer: 4 * 1024 * 1024 });
}

async function cleanup() {
  for (const container of createdContainers.reverse()) {
    await docker(['rm', '-f', container]).catch(() => undefined);
  }
  for (const volume of createdVolumes.reverse()) {
    await docker(['volume', 'rm', volume]).catch(() => undefined);
  }
  await docker(['network', 'rm', network]).catch(() => undefined);
}

try {
  await docker(['pull', 'busybox:1.36'], { timeout: 300_000 });
  await docker(['network', 'create', network]);

  for (const id of requested) {
    const template = byId.get(id);
    const container = `nd-smoke-${id.replace(/[^a-z0-9_.-]/g, '-')}-${suffix}`;
    createdContainers.push(container);
    process.stdout.write(`PULL ${id} (${template.image})\n`);
    await docker(['pull', template.image], { timeout: 900_000 });

    const args = ['run', '-d', '--name', container, '--network', network, '--restart', 'no'];
    if (template.volumeMount) {
      const volume = `nd-smoke-${id.replace(/[^a-z0-9_.-]/g, '-')}-${suffix}`;
      await docker(['volume', 'create', volume]);
      createdVolumes.push(volume);
      args.push('-v', `${volume}:${template.volumeMount}`);
    }
    for (const entry of template.env ?? []) {
      args.push('-e', `${entry.key}=${entry.secret ? randomBytes(24).toString('hex') : entry.value}`);
    }
    args.push(template.image, ...(template.cmd ?? []));
    await docker(args, { timeout: 120_000 });

    const deadline = Date.now() + timeoutSeconds * 1000;
    let ready = false;
    while (Date.now() < deadline) {
      const { stdout: state } = await docker(['inspect', container, '--format', '{{.State.Status}}']);
      if (state.trim() !== 'running') {
        const { stdout: logs } = await docker(['logs', '--tail', '100', container]).catch(() => ({ stdout: '' }));
        throw new Error(`${id} exited before readiness (${state.trim()}):\n${logs}`);
      }
      const { stdout: ip } = await docker(['inspect', container, '--format', `{{with index .NetworkSettings.Networks "${network}"}}{{.IPAddress}}{{end}}`]);
      if (ip.trim()) {
        const probe = await docker([
          'run', '--rm', '--network', network, 'busybox:1.36',
          'nc', '-z', '-w', '3', ip.trim(), String(template.port),
        ], { timeout: 15_000 }).then(() => true).catch(() => false);
        if (probe) {
          ready = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!ready) {
      const { stdout: logs } = await docker(['logs', '--tail', '100', container]).catch(() => ({ stdout: '' }));
      throw new Error(`${id} did not listen on port ${template.port} within ${timeoutSeconds}s:\n${logs}`);
    }
    process.stdout.write(`PASS ${id}: running and listening on ${template.port}/tcp\n`);
    await docker(['rm', '-f', container]);
    createdContainers.splice(createdContainers.indexOf(container), 1);
  }
} finally {
  await cleanup();
}
