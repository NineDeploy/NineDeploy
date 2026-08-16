import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(homedir(), '.ninedeploy');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  baseUrl: string;
  token?: string;
}

const DEFAULTS: CliConfig = { baseUrl: 'http://localhost:3000' };

export function loadConfig(): CliConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return { ...DEFAULTS, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Partial<CliConfig>) };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULTS };
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies at CREATION — re-assert 0600 so a file
  // that ever ended up group/world-readable (restore, copy, old version)
  // holding the bearer token is tightened on every save.
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    /* best-effort on exotic filesystems */
  }
}
