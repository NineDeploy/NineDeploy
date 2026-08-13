import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NINEDEPLOY_HOST: z.string().default('0.0.0.0'),
  NINEDEPLOY_PORT: z.coerce.number().int().positive().default(3000),
  NINEDEPLOY_DATA_DIR: z.string().default('./.data'),
  NINEDEPLOY_DB_PATH: z.string().default('./.data/ninedeploy.db'),
  NINEDEPLOY_PUBLIC_URL: z.url().default('http://localhost:3000'),
  NINEDEPLOY_JWT_SECRET: z.string().min(16).default('dev-insecure-secret-change-me'),
  NINEDEPLOY_JWT_ACCESS_TTL: z.string().default('15m'),
  NINEDEPLOY_JWT_REFRESH_TTL: z.string().default('7d'),
  NINEDEPLOY_MASTER_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = parseEnv();
