import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Locate monorepo root (two levels up from apps/server/src or apps/server/dist)
const repoRoot = existsSync(path.resolve(here, '../../package.json')) ? path.resolve(here, '../..') : process.cwd();

/** Resolve a possibly-relative path against the repoRoot if not absolute. */
const resolve = (p: string) => (p.startsWith('file:') ? p : path.isAbsolute(p) ? p : path.resolve(repoRoot, p));

const dataDir = resolve(env.NINEDEPLOY_DATA_DIR);
mkdirSync(dataDir, { recursive: true });

const dbFile = resolve(env.NINEDEPLOY_DB_PATH);
const dbUrl = dbFile.startsWith('file:') ? dbFile : `file:${dbFile}`;

const reposDir = path.join(dataDir, 'repos');
const logsDir = path.join(dataDir, 'logs');
const backupsDir = path.join(dataDir, 'backups');
for (const dir of [reposDir, logsDir, backupsDir]) mkdirSync(dir, { recursive: true });

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  host: env.NINEDEPLOY_HOST,
  port: env.NINEDEPLOY_PORT,
  publicUrl: env.NINEDEPLOY_PUBLIC_URL,
  paths: {
    dataDir,
    dbFile,
    reposDir,
    logsDir,
    backupsDir,
    masterKeyFile: path.join(dataDir, 'master.key'),
  },
  dbUrl,
  jwt: {
    secret: env.NINEDEPLOY_JWT_SECRET,
    accessTtl: env.NINEDEPLOY_JWT_ACCESS_TTL,
    refreshTtl: env.NINEDEPLOY_JWT_REFRESH_TTL,
  },
  wildcardDomain: process.env['NINEDEPLOY_WILDCARD_DOMAIN'] ?? '',
  // When set, Traefik's ACME resolver issues real Let's Encrypt certificates
  // for domains with the SSL toggle enabled (null disables automatic HTTPS).
  acmeEmail: env.NINEDEPLOY_ACME_EMAIL ?? null,
  acmeCaServer: env.NINEDEPLOY_ACME_CA_SERVER ?? null,
  templatesSource: env.NINEDEPLOY_TEMPLATES_SOURCE ?? null,
  deployConcurrency: env.NINEDEPLOY_DEPLOY_CONCURRENCY,
  dnsProvider: env.NINEDEPLOY_DNS_PROVIDER ?? null,
  dnsToken: env.NINEDEPLOY_DNS_TOKEN ?? null,
  // JSON endpoint returning {"tag_name": "vX.Y.Z", ...} (GitHub Releases format).
  // Set NINEDEPLOY_UPDATE_CHECK_URL=disabled to turn update checks off.
  updateCheckUrl: env.NINEDEPLOY_UPDATE_CHECK_URL ?? 'https://api.github.com/repos/NineDeploy/NineDeploy/releases/latest',
} as const;
