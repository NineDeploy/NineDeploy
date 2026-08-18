import { createClient, NineDeployError } from '@ninedeploy/sdk';
import { loadConfig, saveConfig } from '../config.js';
import { prompt, promptHidden } from '../prompts.js';

/** `ninedeploy login` — authenticate and persist the access token locally. */
export async function loginAction(): Promise<void> {
  const existing = loadConfig();
  const baseUrl = await prompt('Server URL', existing.baseUrl);
  const email = await prompt('Email');
  if (!email) {
    console.error('Email is required.');
    process.exitCode = 1;
    return;
  }
  const password = await promptHidden('Password');
  if (!password) {
    console.error('Password is required.');
    process.exitCode = 1;
    return;
  }

  const client = createClient({ baseUrl });
  try {
    const session = await client.auth.login({ email, password });
    saveConfig({ baseUrl, token: session.tokens.accessToken });
    console.log(`✓ Logged in as ${session.user.email} (${session.user.role})`);
  } catch (err) {
    if (err instanceof NineDeployError) {
      console.error(`✗ Login failed (${err.status}): ${err.message}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('✗ Login failed:', msg);
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        console.error(`  Could not reach NineDeploy server at ${baseUrl}. Check your URL or ensure the server is running.`);
      }
    }
    process.exitCode = 1;
  }
}
