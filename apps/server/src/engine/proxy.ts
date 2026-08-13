import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { domains, services, type DB } from '@ninedeploy/db';
import { config } from '../config.js';
import { capture, run, sleep } from '../lib/exec.js';

const TRAEFIK_CONTAINER = 'ninedeploy-traefik';
const TRAEFIK_IMAGE = 'traefik:v3.3';

/** Shared Docker network that app + database containers join to reach each other. */
export const NETWORK = 'ninedeploy';

/** Ensure the shared `ninedeploy` network exists (idempotent). */
export async function ensureNetwork(log: (line: string) => void): Promise<void> {
  try {
    const list = await capture('docker', ['network', 'ls', '--filter', `name=^${NETWORK}$`, '--format', '{{.Name}}']);
    if (list.includes(NETWORK)) return;
    await run('docker', ['network', 'create', NETWORK], {}, log);
    log(`network '${NETWORK}' created`);
  } catch (err) {
    log(`network warning: ${err instanceof Error ? err.message : err}`);
  }
}

const STATIC_CONFIG = `# Managed by NineDeploy — do not edit by hand.
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
providers:
  file:
    filename: /etc/traefik/dynamic.yml
    watch: true
api:
  dashboard: false
log:
  level: INFO
accessLog: {}
`;

/** Path helpers for the Traefik config directory under the data dir. */
const dir = () => path.join(config.paths.dataDir, 'traefik');
const staticPath = () => path.join(dir(), 'traefik.yml');
const dynamicPath = () => path.join(dir(), 'dynamic.yml');

/** Whether `container` is attached to `network`. */
async function onNetwork(container: string, network: string): Promise<boolean> {
  try {
    const out = await capture('docker', ['inspect', container, '--format', '{{json .NetworkSettings.Networks}}']);
    return out.includes(`"${network}"`);
  } catch {
    return false;
  }
}

/** Ensure the Traefik reverse-proxy container is running on the shared network (idempotent). */
export async function ensureTraefik(log: (line: string) => void): Promise<void> {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(staticPath(), STATIC_CONFIG);
  if (!existsSync(dynamicPath())) writeFileSync(dynamicPath(), 'http:\n  routers:\n  services:\n');

  try {
    const running = (await capture('docker', ['ps', '-q', '-f', `name=^${TRAEFIK_CONTAINER}$`])).trim();
    if (running && (await onNetwork(TRAEFIK_CONTAINER, NETWORK))) {
      log('traefik already running on shared network');
      return;
    }
    // Recreate so it joins the network (the only publicly exposed service).
    await run('docker', ['rm', '-f', TRAEFIK_CONTAINER], {}, () => {}).catch(() => undefined);

    log('starting traefik container …');
    await run(
      'docker',
      [
        'run', '-d', '--name', TRAEFIK_CONTAINER, '--restart', 'unless-stopped',
        '--network', NETWORK,
        '-p', '80:80', '-p', '443:443',
        '-v', `${staticPath()}:/etc/traefik/traefik.yml:ro`,
        '-v', `${dynamicPath()}:/etc/traefik/dynamic.yml:ro`,
        TRAEFIK_IMAGE,
      ],
      {},
      log,
    );
    await sleep(1000);
    log('traefik started (http :80 / https :443) on shared network');
  } catch (err) {
    log(`traefik warning: ${err instanceof Error ? err.message : err}`);
    log('domain routing will be unavailable until traefik can bind :80/:443');
  }
}

/**
 * Regenerate the Traefik dynamic config from the DB: one router+service per
 * domain pointing at the service's published port. Called after deploys and
 * domain changes.
 */
export async function writeDynamicConfig(db: DB): Promise<void> {
  const all = await db.select().from(domains);
  const servicesById = new Map(
    (await db.select().from(services)).map((s) => [s.id, s]),
  );

  const routers: string[] = [];
  const svcBlocks: string[] = [];
  const seen = new Set<string>();

  for (const d of all) {
    const svc = servicesById.get(d.serviceId);
    if (!svc || !svc.port || !svc.runtimeId) continue; // need a running container to route to
    const key = `${svc.slug}_${d.id}`;
    const host = d.hostname.replace(/[`"]/g, '');
    const entry = d.ssl ? 'websecure' : 'web';
    routers.push(
      `    ${key}:\n` +
        `      rule: "Host(\`${host}\`)${d.path && d.path !== '/' ? ` && PathPrefix(\`${d.path}\`)` : ''}"\n` +
        `      service: svc_${key}\n` +
        `      entryPoints:\n        - ${entry}` +
        (d.ssl ? `\n      tls: {}` : ''),
    );
    if (!seen.has(`svc_${key}`)) {
      seen.add(`svc_${key}`);
      svcBlocks.push(
        `    svc_${key}:\n` +
          `      loadBalancer:\n` +
          `        servers:\n` +
          `          - url: "http://${svc.runtimeId}:${svc.port}"`,
      );
    }
  }

  const yaml =
    '# Managed by NineDeploy — regenerated on deploy/domain changes.\n' +
    'http:\n' +
    '  routers:\n' +
    (routers.length ? routers.join('\n') + '\n' : '    {}\n') +
    '  services:\n' +
    (svcBlocks.length ? svcBlocks.join('\n') + '\n' : '    {}\n');

  writeFileSync(dynamicPath(), yaml);
}
