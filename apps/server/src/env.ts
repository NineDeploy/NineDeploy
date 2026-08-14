import 'dotenv/config';
import { z } from 'zod';

/** The insecure dev-only JWT secret. Never permitted in production. */
export const INSECURE_JWT_SECRET = 'dev-insecure-secret-change-me';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NINEDEPLOY_HOST: z.string().default('0.0.0.0'),
  NINEDEPLOY_PORT: z.coerce.number().int().positive().default(3000),
  NINEDEPLOY_DATA_DIR: z.string().default('./.data'),
  NINEDEPLOY_DB_PATH: z.string().default('./.data/ninedeploy.db'),
  NINEDEPLOY_PUBLIC_URL: z.url().default('http://localhost:3000'),
  NINEDEPLOY_JWT_SECRET: z.string().min(16).default(INSECURE_JWT_SECRET),
  NINEDEPLOY_JWT_ACCESS_TTL: z.string().default('15m'),
  NINEDEPLOY_JWT_REFRESH_TTL: z.string().default('7d'),
  NINEDEPLOY_MASTER_KEY: z.string().optional(),
  // Let's Encrypt registration email — enables automatic HTTPS (Traefik ACME).
  NINEDEPLOY_ACME_EMAIL: z.string().optional(),
  // Template registry source override: an https URL or an absolute path to a
  // JSON registry bundle. Falls back to the bundled registry when unset.
  NINEDEPLOY_TEMPLATES_SOURCE: z.string().optional(),
  // ACME DNS-01 challenge (wildcard certificates). DB settings win over these.
  NINEDEPLOY_DNS_PROVIDER: z.string().optional(),
  NINEDEPLOY_DNS_TOKEN: z.string().optional(),
  // How many deployments the worker processes in parallel (1-8). The same
  // service is never deployed concurrently regardless of this value.
  NINEDEPLOY_DEPLOY_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  // Hard guard: the publicly-known default JWT secret would let anyone forge
  // tokens, so refuse to boot in production with it still in place. (Only
  // evaluated on a successful parse; on failure we already exited above.)
  if (parsed.success && parsed.data.NODE_ENV === 'production' && parsed.data.NINEDEPLOY_JWT_SECRET === INSECURE_JWT_SECRET) {
    // eslint-disable-next-line no-console
    console.error(
      '❌ NINEDEPLOY_JWT_SECRET must be set to a strong, unique secret in production. The insecure default is not allowed.',
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = parseEnv();
