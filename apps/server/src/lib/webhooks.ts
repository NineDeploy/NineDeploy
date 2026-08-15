import { createHmac, timingSafeEqual } from 'node:crypto';

export type Provider = 'github' | 'gitlab' | 'gitea';

export interface PushEvent {
  branch: string;
  sha: string;
  message: string;
  author: string;
  repoUrl?: string;
  /** Paths added/modified/removed across the push (drives watch-path filtering). */
  changedFiles: string[];
}

/** Constant-time comparison of two hex/base64 strings. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function hmac(secret: string, body: string, digest: 'hex' | 'base64'): string {
  return createHmac('sha256', secret).update(body).digest(digest);
}

/**
 * Detect the provider from request headers and verify the signature/token.
 * Returns the provider when valid, otherwise null.
 */
export function verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string, secret: string): Provider | null {
  const h = (k: string) => {
    const v = headers[k];
    return typeof v === 'string' ? v : undefined;
  };

  // GitHub
  if (h('x-github-event')) {
    const sig = h('x-hub-signature-256');
    if (!sig?.startsWith('sha256=')) return null;
    const expected = 'sha256=' + hmac(secret, rawBody, 'hex');
    return safeEqual(sig, expected) ? 'github' : null;
  }

  // Gitea (GitHub-compatible payload, hex HMAC)
  if (h('x-gitea-event') || h('x-gitea-signature')) {
    const sig = h('x-gitea-signature');
    if (!sig) return null;
    return safeEqual(sig, hmac(secret, rawBody, 'hex')) ? 'gitea' : null;
  }

  // GitLab (token sent directly in a header)
  if (h('x-gitlab-event') || h('x-gitlab-token')) {
    const token = h('x-gitlab-token');
    if (!token) return null;
    return safeEqual(token, secret) ? 'gitlab' : null;
  }

  return null;
}

/** Whether this request is a provider "ping" (no deploy action needed). */
export function isPing(headers: Record<string, string | string[] | undefined>, provider: Provider): boolean {
  const h = (k: string) => {
    const v = headers[k];
    return typeof v === 'string' ? v : undefined;
  };
  if (provider === 'github' || provider === 'gitea') return h('x-github-event') === 'ping' || h('x-gitea-event') === 'ping';
  return h('x-gitlab-event') === 'Ping Hook';
}

/** Collect added/modified/removed paths from a commits array. */
function changedFilesFrom(commits: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const c of commits) {
    for (const key of ['added', 'modified', 'removed'] as const) {
      const list = c[key];
      if (Array.isArray(list)) {
        for (const f of list) if (typeof f === 'string') out.push(f);
      }
    }
  }
  return out;
}

/** Parse a push payload into the fields the deploy pipeline needs. */
export function parsePush(body: unknown, provider: Provider): PushEvent | null {
  const b = body as Record<string, unknown>;
  const ref = typeof b['ref'] === 'string' ? (b['ref'] as string) : '';
  const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  if (!branch) return null;

  if (provider === 'gitlab') {
    const commits = (b['commits'] as Array<Record<string, unknown>> | undefined) ?? [];
    const last = commits[commits.length - 1];
    if (!last) return null;
    const author = (last['author'] as Record<string, unknown> | undefined)?.['name'];
    const project = b['project'] as Record<string, unknown> | undefined;
    return {
      branch,
      sha: String(last['id'] ?? ''),
      message: String(last['message'] ?? ''),
      author: String(author ?? ''),
      repoUrl: typeof project?.['git_http_url'] === 'string' ? (project['git_http_url'] as string) : undefined,
      changedFiles: changedFilesFrom(commits),
    };
  }

  // GitHub & Gitea share the same shape.
  const head = (b['head_commit'] as Record<string, unknown> | undefined) ?? {};
  const author = (head['author'] as Record<string, unknown> | undefined);
  const repo = (b['repository'] as Record<string, unknown> | undefined);
  const commits = (b['commits'] as Array<Record<string, unknown>> | undefined) ?? [];
  const withHead = [...commits, ...(Object.keys(head).length > 0 ? [head] : [])];
  return {
    branch,
    sha: String(head['id'] ?? ''),
    message: String(head['message'] ?? ''),
    author: String(author?.['username'] ?? ''),
    repoUrl: typeof repo?.['clone_url'] === 'string' ? (repo['clone_url'] as string) : undefined,
    changedFiles: changedFilesFrom(withHead),
  };
}
