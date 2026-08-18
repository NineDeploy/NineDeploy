import { createClient, NineDeployError } from '@ninedeploy/sdk';
import { loadConfig, saveConfig } from '../config.js';
import { prompt, promptHidden } from '../prompts.js';

/** `ninedeploy setup` — create the first admin user on a fresh instance. */
export async function setupAction(): Promise<void> {
  const existing = loadConfig();
  const baseUrl = await prompt('Server URL', existing.baseUrl);
  const email = await prompt('Admin email');
  if (!email) {
    console.error('Email is required.');
    process.exitCode = 1;
    return;
  }
  const name = (await prompt('Display name (optional)')) || undefined;
  const password = await promptHidden('Password (min 8 chars)');
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const client = createClient({ baseUrl });
  try {
    const session = await client.auth.setup({ email, password, name });
    saveConfig({ baseUrl, token: session.tokens.accessToken });
    console.log(`✓ Admin account created: ${session.user.email}`);
    console.log('  Credentials saved — you are logged in.');
  } catch (err) {
    if (err instanceof NineDeployError) {
      console.error(`✗ Setup failed (${err.status}): ${err.message}`);
      if (err.status === 409) console.error('  The instance already has an admin user.');
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('✗ Setup failed:', msg);
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        console.error(`  Could not connect to NineDeploy server at ${baseUrl}. Ensure the server is running.`);
      }
    }
    process.exitCode = 1;
  }
}
