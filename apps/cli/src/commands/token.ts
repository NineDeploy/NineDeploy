import { NineDeployError } from '@ninedeploy/sdk';
import { getClient } from '../client.js';
import { prompt } from '../prompts.js';

/** `ninedeploy token create` — mint an API token (shown once). */
export async function tokenCreateAction(): Promise<void> {
  const name = (await prompt('Token name', 'ci')) || 'ci';
  try {
    const created = await getClient().auth.tokens.create({ name });
    console.log(`✓ Token "${created.name}" created (id: ${created.id}).`);
    console.log('  This token is shown ONCE — store it securely:');
    console.log(`  ${created.token}`);
    console.log('  Use it as: Authorization: Bearer <token>');
  } catch (err) {
    console.error(
      '✗ Could not create token:',
      err instanceof NineDeployError ? err.message : err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
  }
}

/** `ninedeploy token list` — list API tokens (without secrets). */
export async function tokenListAction(): Promise<void> {
  const tokens = await getClient().auth.tokens.list();
  if (tokens.length === 0) {
    console.log('No API tokens.');
    return;
  }
  console.table(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      lastUsed: t.lastUsedAt ?? 'never',
      created: t.createdAt,
    })),
  );
}
