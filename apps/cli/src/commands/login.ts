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
      console.error('✗ Login failed:', err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  }
}
