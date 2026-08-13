import type { Tunnel } from '@ninedeploy/db';
import { decrypt } from '../lib/crypto.js';
import { run } from '../lib/exec.js';
import { NETWORK } from './proxy.js';

const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:latest';

/** Run a Cloudflare Tunnel (cloudflared) connected to the shared network. */
export async function startTunnel(t: Tunnel, log: (line: string) => void): Promise<void> {
  const token = decrypt(t.tokenEncrypted);
  log(`Starting Cloudflare Tunnel ${t.name} (${t.containerName}) …`);
  await run(
    'docker',
    ['run', '-d', '--name', t.containerName, '--network', NETWORK, '--restart', 'unless-stopped', CLOUDFLARED_IMAGE, 'tunnel', '--no-autoupdate', 'run', '--token', token],
    {},
    log,
  );
}

/** Stop + remove a tunnel container. */
export async function stopTunnel(t: Tunnel): Promise<void> {
  await run('docker', ['rm', '-f', t.containerName], {}, () => {}).catch(() => undefined);
}
