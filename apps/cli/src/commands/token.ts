import { NineDeployError } from '@ninedeploy/sdk';
import { getClient } from '../client.js';
import { prompt } from '../prompts.js';

/**
 * Normalise a typed scope answer. Empty input keeps the legacy "unrestricted"
 * behaviour, which is what every pre-0.3.5 token has; anything unrecognised is
 * dropped rather than silently widening the token.
 */
export function parseScopes(answer: string): Array<'read' | 'write' | 'operator'> {
  const valid = new Set(['read', 'write', 'operator']);
  return answer
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is 'read' | 'write' | 'operator' => valid.has(s));
}

/** `ninedeploy token create` — mint an API token (shown once). */
export async function tokenCreateAction(): Promise<void> {
  const name = (await prompt('Token name', 'ci')) || 'ci';
  // read = safe methods only · write = mutate as a non-operator ·
  // operator = no extra restriction. Blank = unrestricted (legacy).
  const scopes = parseScopes(await prompt('Scopes (read,write,operator — blank = unrestricted)', 'write'));
  try {
    const created = await getClient().auth.tokens.create({ name, scopes });
    console.log(`✓ Token "${created.name}" created (id: ${created.id}).`);
    console.log(`  Scopes: ${created.scopes.length ? created.scopes.join(', ') : 'unrestricted (legacy)'}`);
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
      scopes: t.scopes.length ? t.scopes.join(',') : 'unrestricted',
      lastUsed: t.lastUsedAt ?? 'never',
      expires: t.expiresAt ?? 'never',
      created: t.createdAt,
    })),
  );
}
