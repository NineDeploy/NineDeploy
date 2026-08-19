import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// Resolve the data dir relative to the repo root so it matches the server,
// regardless of which package dir the CLI is invoked from.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const defaultDb = path.join(repoRoot, '.data', 'ninedeploy.db');

const dbPath = process.env['NINEDEPLOY_DB_PATH'] ?? defaultDb;
const cleanPath = dbPath.replace(/^file:/, '');
try {
  mkdirSync(path.dirname(path.resolve(cleanPath)), { recursive: true });
} catch {
  // safe ignore
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: dbPath.startsWith('file:') ? dbPath : `file:${dbPath}`,
  },
  verbose: true,
  strict: true,
});
