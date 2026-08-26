/**
 * Client-side secret lint for the Manifest Creator preview.
 *
 * The full server-side scan (in `@ninedeploy/server`) runs at deploy time
 * with a 13-pattern list. For the form preview we run a tiny check that
 * surfaces the most common slips — AWS keys, GitHub PATs, raw database
 * URLs with embedded credentials — and flags the offending field name
 * so the operator can fix it before pushing.
 */
import type { NinedeployManifest } from '@ninedeploy/schemas';

const CLIENT_PATTERNS: ReadonlyArray<{ id: string; regex: RegExp; description: string }> = [
  { id: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/, description: 'AWS access key id' },
  { id: 'github-pat', regex: /\bghp_[A-Za-z0-9]{36}\b/, description: 'GitHub classic PAT' },
  {
    id: 'database-url-creds',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@'"]+:[^\s@'"]{3,}@/i,
    description: 'Database URL with embedded credentials',
  },
];

export interface SecretLintHit {
  patternId: string;
  description: string;
  /** Index path of the field in the manifest ("env.aliases.DATABASE_URL"). */
  path: string;
  /** The offending value, redacted. */
  redacted: string;
}

const REDACT_LEN_LIMIT = 8;
const redact = (value: string): string =>
  value.length <= REDACT_LEN_LIMIT
    ? `<redacted:${value.length}>`
    : `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;

/** Walk every string value in a manifest and return any secret-pattern hits. */
export function lintManifest(manifest: NinedeployManifest): SecretLintHit[] {
  const hits: SecretLintHit[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      for (const pattern of CLIENT_PATTERNS) {
        const match = pattern.regex.exec(value);
        if (match && match.index !== undefined) {
          hits.push({
            patternId: pattern.id,
            description: pattern.description,
            path,
            redacted: redact(match[0]),
          });
        }
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        visit(value[i], `${path}[${i}]`);
      }
    }
  };
  visit(manifest, '');
  return hits;
}
