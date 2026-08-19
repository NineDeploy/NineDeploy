import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Tunnel } from '@ninedeploy/db';
import { decrypt } from '../lib/crypto.js';
import { run } from '../lib/exec.js';
import { ensureDockerImage } from '../lib/dockerPull.js';
import { NETWORK } from './proxy.js';

const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:latest';

/** Run a Cloudflare Tunnel (cloudflared) connected to the shared network. */
export async function startTunnel(t: Tunnel, log: (line: string) => void): Promise<void> {
  await ensureDockerImage(CLOUDFLARED_IMAGE, log);
  const token = decrypt(t.tokenEncrypted);
  // Pass the token via a temp env-file (mode 0600) instead of a `--token` argv
  // value, so the Cloudflare token never shows up in `ps` or `docker inspect`
  // for any local user. cloudflared reads it from the TUNNEL_TOKEN env. The file
  // is removed right after `docker run` (the value is already baked into the
  // container config by then).
  const envFile = path.join(tmpdir(), `nd-tunnel-${process.pid}-${Date.now()}.env`);
  mkdirSync(path.dirname(envFile), { recursive: true });
  writeFileSync(envFile, `TUNNEL_TOKEN=${token}\n`, { mode: 0o600 });
  log(`Starting Cloudflare Tunnel ${t.name} (${t.containerName}) …`);
  try {
    await run(
      'docker',
      [
        'run', '-d', '--name', t.containerName, '--network', NETWORK, '--restart', 'unless-stopped',
        '--env-file', envFile,
        CLOUDFLARED_IMAGE, 'tunnel', '--no-autoupdate', 'run',
      ],
      {},
      log,
    );
  } finally {
    try {
      unlinkSync(envFile);
    } catch {
      /* already removed */
    }
  }
}

/** Stop + remove a tunnel container. */
export async function stopTunnel(t: Tunnel): Promise<void> {
  await run('docker', ['rm', '-f', t.containerName], {}, () => {}).catch(() => undefined);
}
