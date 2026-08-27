import { describe, expect, it } from 'vitest';
import { template as templateSchema } from '@ninedeploy/schemas';
import {
  composeServiceKey,
  parseMagicToken,
  preflightCompose,
  resolveStackEnvironment,
  scanMagicTokens,
  scanRequiredPlaceholders,
} from '../src/engine/magicVars.js';

describe('compose stack preflight', () => {
  it('blocks env_file and inline content: mounts with reasons', () => {
    const pre = preflightCompose('services:\n  a:\n    env_file: .env.shared\n');
    expect(pre.ok).toBe(false);
    expect(pre.reasons[0]).toContain('env_file');

    const pre2 = preflightCompose('      - type: bind\n        content: "<xml/>"\n');
    expect(pre2.ok).toBe(false);
    expect(pre2.reasons[0]).toContain('content:');
  });

  it('keeps external resources and host networking as warnings only', () => {
    const pre = preflightCompose('volumes:\n  data:\n    external: true\nnetwork_mode: host\n');
    expect(pre.ok).toBe(true);
    expect(pre.warnings.length).toBe(2);
  });
});

describe('magic token classification', () => {
  it('matches upstream generation families', () => {
    // Upstream: Str::random(16) users, Str::password(32) default passwords.
    expect(parseMagicToken('SERVICE_USER_POSTGRES')).toMatchObject({ kind: 'user' });
    expect(parseMagicToken('SERVICE_LOWERCASEUSER_DB')).toMatchObject({ kind: 'lowercaseUser' });
    expect(parseMagicToken('SERVICE_PASSWORD_POSTGRES')).toMatchObject({ kind: 'password', size: 32 });
    expect(parseMagicToken('SERVICE_PASSWORD_64_APPWRITE')).toMatchObject({ kind: 'password', size: 64 });
    expect(parseMagicToken('SERVICE_PASSWORDWITHSYMBOLS_JICOFO')).toMatchObject({ kind: 'password', size: 32 });

    // The BASE64_ family is NOT base64 — plain N-character random strings.
    expect(parseMagicToken('SERVICE_BASE64_64_KEY')).toMatchObject({ kind: 'randomLength', size: 64 });
    expect(parseMagicToken('SERVICE_BASE64_128_SESSION')).toMatchObject({ kind: 'randomLength', size: 128 });
    expect(parseMagicToken('SERVICE_BASE64_SECRET')).toMatchObject({ kind: 'randomLength', size: 64 });

    // REALBASE64_ encodes N random BYTES; default is 32 like the upstream helper.
    expect(parseMagicToken('SERVICE_REALBASE64_32_TOTP')).toMatchObject({ kind: 'realBase64', size: 32 });
    expect(parseMagicToken('SERVICE_REALBASE64_SALT')).toMatchObject({ kind: 'realBase64', size: 32 });

    expect(parseMagicToken('SERVICE_HEX_32_RPCSECRET')).toMatchObject({ kind: 'hex', size: 32 });
    expect(parseMagicToken('SERVICE_HEX_64_RPCSECRET')).toMatchObject({ kind: 'hex', size: 64 });

    // Legacy alias kept for compatibility with existing stacks.
    expect(parseMagicToken('SERVICE_PASSWORD_BASE64_JWT')).toMatchObject({ kind: 'password', size: 64 });
  });

  it('splits URL_/FQDN_ targets into service and optional port', () => {
    expect(parseMagicToken('SERVICE_URL_N8N')).toMatchObject({ kind: 'url', target: { service: 'N8N', port: null } });
    expect(parseMagicToken('SERVICE_FQDN_APPWRITE')).toMatchObject({ kind: 'fqdn', target: { service: 'APPWRITE', port: null } });
    expect(parseMagicToken('SERVICE_URL_SUPABASEKONG_8000')).toMatchObject({
      kind: 'url',
      target: { service: 'SUPABASEKONG', port: 8000 },
    });
  });

  it('passes unknown SERVICE_* names through untouched', () => {
    // App-specific prefixes (supabase JWT keys etc.) are not ours to invent.
    expect(parseMagicToken('SERVICE_SUPABASEANON_KEY')).toBeNull();
    expect(parseMagicToken('SERVICE_ROLE_KEY')).toBeNull();
    expect(parseMagicToken('service_password_x')).toBeNull(); // case-sensitive tokens
  });
});

describe('stack environment resolution', () => {
  const COMPOSE = [
    'services:',
    '  umami:',
    '    image: ghcr.io/umami-software/umami:3.0.3',
    '    environment:',
    '      - SERVICE_URL_UMAMI_3000',
    '      - DATABASE_URL=postgres://$SERVICE_USER_POSTGRES:$SERVICE_PASSWORD_POSTGRES@postgresql:5432/$POSTGRES_DB',
    '      - APP_SECRET=$SERVICE_PASSWORD_64_UMAMI',
    '  postgresql:',
    '    environment:',
    '      - POSTGRES_USER=$SERVICE_USER_POSTGRES',
    '      - POSTGRES_PASSWORD=$SERVICE_PASSWORD_POSTGRES',
    '      - POSTGRES_DB=${POSTGRES_DB:-umami}',
].join('\n');

  it('resolves each distinct token exactly once across every service', () => {
    let generated = 0;
    const fixed = (spec: { kind: string }) => {
      generated += 1;
      return `FIXED:${spec.kind}`;
    };
    const resolved = resolveStackEnvironment(COMPOSE, { publicUrl: 'https://umami-x1.panel.dev', generate: fixed });

    // One generation per DISTINCT secret token; shared tokens are never rolled twice.
    expect(generated).toBe(3);
    expect(resolved.values.SERVICE_USER_POSTGRES).toBe('FIXED:user');
    expect(resolved.values.SERVICE_PASSWORD_POSTGRES).toBe('FIXED:password');
    expect(scanMagicTokens(COMPOSE)).toEqual([
      'SERVICE_PASSWORD_64_UMAMI',
      'SERVICE_PASSWORD_POSTGRES',
      'SERVICE_URL_UMAMI_3000',
      'SERVICE_USER_POSTGRES',
    ]);
    expect(resolved.values.SERVICE_URL_UMAMI_3000).toBe('https://umami-x1.panel.dev');
    expect(resolved.parsed.SERVICE_PASSWORD_64_UMAMI).toMatchObject({ kind: 'password', size: 64 });
  });

  it('surfaces defaultless placeholders so compose never bakes silent empties', () => {
    const resolved = resolveStackEnvironment(COMPOSE, { publicUrl: 'https://x.test' });
    expect(resolved.openPlaceholders).toEqual(['POSTGRES_DB']);
    expect(resolved.values.POSTGRES_DB).toBe('');
  });

  it('derives FQDN from the public URL host without scheme', () => {
    const resolved = resolveStackEnvironment('$SERVICE_FQDN_APPWRITE', { publicUrl: 'https://app-9.panel.dev' });
    expect(resolved.values.SERVICE_FQDN_APPWRITE).toBe('app-9.panel.dev');
  });

  it('normalizes compose service names like the upstream router', () => {
    expect(composeServiceKey('supabase-kong')).toBe('SUPABASEKONG');
    expect(composeServiceKey('app.writer')).toBe('APP_WRITER');
  });
});

describe('template schema with compose stacks', () => {
  it('accepts a compose template and keeps single-container ones valid', () => {
    const legacy = { id: 'x', name: 'X', tagline: 't', description: 'd', category: 'c', emoji: '🙂', image: 'a/b:1', port: 80 };
    expect(templateSchema.safeParse(legacy).success).toBe(true);

    const stack = { ...legacy, composeContent: 'services:\n  x:\n    image: a/b:1\n', composeService: 'x' };
    expect(templateSchema.safeParse(stack).success).toBe(true);

    const missing = { ...legacy, composeContent: 'services:\n' };
    expect(templateSchema.safeParse(missing).success).toBe(false);
  });
});
