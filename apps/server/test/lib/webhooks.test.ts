import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPing, isPullRequest, parsePullRequest, parsePush, verifyWebhook } from '../../src/lib/webhooks.js';

const SECRET = 'whsec_test';

const sig = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
const giteaSig = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

const githubHeaders = (body: string, overrides: Record<string, string> = {}) => ({
  'x-github-event': 'push',
  'x-hub-signature-256': sig(body),
  ...overrides,
});

describe('verifyWebhook', () => {
  it('accepts a valid GitHub signature', () => {
    expect(verifyWebhook(githubHeaders('{"a":1}'), '{"a":1}', SECRET)).toBe('github');
  });

  it('rejects a GitHub request with a wrong signature', () => {
    const h = githubHeaders('{"a":1}');
    h['x-hub-signature-256'] = sig('tampered');
    expect(verifyWebhook(h, '{"a":1}', SECRET)).toBeNull();
  });

  it('rejects a GitHub request without a signature header', () => {
    expect(verifyWebhook({ 'x-github-event': 'push' }, '{}', SECRET)).toBeNull();
  });

  it('rejects a GitHub signature that is not sha256-prefixed', () => {
    const h = githubHeaders('{}');
    h['x-hub-signature-256'] = 'md5=deadbeef';
    expect(verifyWebhook(h, '{}', SECRET)).toBeNull();
  });

  it('accepts a valid Gitea signature', () => {
    const h = { 'x-gitea-event': 'push', 'x-gitea-signature': giteaSig('{}') };
    expect(verifyWebhook(h, '{}', SECRET)).toBe('gitea');
  });

  it('rejects a Gitea request without a signature', () => {
    expect(verifyWebhook({ 'x-gitea-event': 'push' }, '{}', SECRET)).toBeNull();
  });

  it('rejects a Gitea request with a wrong signature', () => {
    const h = { 'x-gitea-event': 'push', 'x-gitea-signature': giteaSig('tampered') };
    expect(verifyWebhook(h, '{}', SECRET)).toBeNull();
  });

  it('accepts a valid GitLab token', () => {
    expect(verifyWebhook({ 'x-gitlab-event': 'Push Hook', 'x-gitlab-token': SECRET }, '{}', SECRET)).toBe('gitlab');
  });

  it('rejects a GitLab request without a token', () => {
    expect(verifyWebhook({ 'x-gitlab-event': 'Push Hook' }, '{}', SECRET)).toBeNull();
  });

  it('rejects a GitLab request with a wrong token', () => {
    expect(verifyWebhook({ 'x-gitlab-token': 'wrong' }, '{}', SECRET)).toBeNull();
  });

  it('returns null when no provider header is present', () => {
    expect(verifyWebhook({}, '{}', SECRET)).toBeNull();
  });

  it('handles array-valued headers by ignoring them', () => {
    const h = githubHeaders('{}', { 'x-github-event': ['push'] as unknown as string });
    expect(verifyWebhook(h, '{}', SECRET)).toBeNull();
  });
});

describe('isPing', () => {
  it('detects GitHub and Gitea pings', () => {
    expect(isPing({ 'x-github-event': 'ping' }, 'github')).toBe(true);
    expect(isPing({ 'x-github-event': 'push' }, 'github')).toBe(false);
    expect(isPing({ 'x-gitea-event': 'ping' }, 'gitea')).toBe(true);
    expect(isPing({ 'x-gitea-event': 'push' }, 'gitea')).toBe(false);
  });

  it('detects GitLab ping hooks', () => {
    expect(isPing({ 'x-gitlab-event': 'Ping Hook' }, 'gitlab')).toBe(true);
    expect(isPing({ 'x-gitlab-event': 'Push Hook' }, 'gitlab')).toBe(false);
  });
});

describe('parsePush', () => {
  it('parses a GitHub push payload', () => {
    const body = {
      ref: 'refs/heads/main',
      head_commit: { id: 'abc123', message: 'hello', author: { username: 'ada' } },
      repository: { clone_url: 'https://github.com/ada/repo.git' },
    };
    expect(parsePush(body, 'github')).toEqual({
      branch: 'main',
      sha: 'abc123',
      message: 'hello',
      author: 'ada',
      repoUrl: 'https://github.com/ada/repo.git',
      changedFiles: [],
      commitsListed: 1,
    });
  });

  it('reports the listed commit count so watch-path gating can detect truncation', () => {
    // GitHub caps `commits` at ~20 for big pushes — the receiver uses the
    // count to fail open instead of silently skipping a watched change that
    // happened in an omitted commit.
    const commits = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      added: [`f${i}.txt`],
      modified: [],
      removed: [],
    }));
    const body = {
      ref: 'refs/heads/main',
      head_commit: { id: 'head', message: 'big push', author: { username: 'ada' } },
      commits,
    };
    expect(parsePush(body, 'github')?.commitsListed).toBe(21);
  });

  it('parses a GitHub payload with a bare ref (not refs/heads/)', () => {
    const body = { ref: 'feature/x', head_commit: { id: 'x', message: 'm' } };
    expect(parsePush(body, 'github')?.branch).toBe('feature/x');
  });

  it('handles a GitHub payload without head_commit', () => {
    const body = { ref: 'refs/heads/main' };
    const result = parsePush(body, 'github');
    expect(result).toMatchObject({ branch: 'main', sha: '', message: '', author: '' });
    expect(result?.repoUrl).toBeUndefined();
  });

  it('returns null for an empty ref', () => {
    expect(parsePush({ ref: '' }, 'github')).toBeNull();
    expect(parsePush({}, 'github')).toBeNull();
  });

  it('returns null for a null or undefined body (r010)', () => {
    // Fastify parses a JSON body of literal `null` to null, and the public
    // webhook receiver hands it straight to parsePush — it must be a graceful
    // null (same contract as parsePullRequest), never a TypeError.
    expect(parsePush(null, 'github')).toBeNull();
    expect(parsePush(null, 'gitlab')).toBeNull();
    expect(parsePush(undefined, 'gitea')).toBeNull();
  });

  it('returns null for a GitHub branch-deletion push (r009)', () => {
    const body = {
      ref: 'refs/heads/main',
      before: 'e5a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9',
      after: '0'.repeat(40),
      deleted: true,
      head_commit: null,
      commits: [],
    };
    expect(parsePush(body, 'github')).toBeNull();
  });

  it('returns null for a Gitea branch-deletion push (r009)', () => {
    const body = {
      ref: 'refs/heads/main',
      after: '0'.repeat(40),
      deleted: true,
      head_commit: null,
      commits: [],
    };
    expect(parsePush(body, 'gitea')).toBeNull();
  });

  it('returns null when `after` is all zeros even without a deleted flag (r009)', () => {
    // The all-zero `after` is the canonical deletion marker shared by
    // GitHub, Gitea, and GitLab; older payloads may omit `deleted`.
    const body = { ref: 'refs/heads/main', after: '0'.repeat(40), head_commit: null };
    expect(parsePush(body, 'github')).toBeNull();
  });

  it('still parses a normal push that carries an `after` sha (r009 guard does not overfire)', () => {
    const body = {
      ref: 'refs/heads/main',
      after: 'abc123def456abc123def456abc123def456abc1',
      head_commit: { id: 'abc123def456abc123def456abc123def456abc1', message: 'feat: x' },
    };
    expect(parsePush(body, 'github')?.sha).toBe('abc123def456abc123def456abc123def456abc1');
  });

  it('parses a GitLab push payload', () => {
    const body = {
      ref: 'refs/heads/main',
      commits: [{ id: 'c1', message: 'first', author: { name: 'Bob' } }],
      project: { git_http_url: 'https://gitlab.com/bob/repo.git' },
    };
    expect(parsePush(body, 'gitlab')).toEqual({
      branch: 'main',
      sha: 'c1',
      message: 'first',
      author: 'Bob',
      repoUrl: 'https://gitlab.com/bob/repo.git',
      changedFiles: [],
      commitsListed: 1,
    });
  });

  it('returns null for a GitLab payload with no commits', () => {
    expect(parsePush({ ref: 'refs/heads/main', commits: [] }, 'gitlab')).toBeNull();
  });

  it('returns null for a GitLab payload without a commits key', () => {
    expect(parsePush({ ref: 'refs/heads/main' }, 'gitlab')).toBeNull();
  });

  it('parses a GitLab commit with no id or message', () => {
    const body = { ref: 'refs/heads/main', commits: [{}] };
    expect(parsePush(body, 'gitlab')).toMatchObject({
      branch: 'main',
      sha: '',
      message: '',
      author: '',
    });
  });

  it('parses a GitLab payload with missing author name and repo url', () => {
    const body = { ref: 'refs/heads/main', commits: [{ id: 'c2' }] };
    expect(parsePush(body, 'gitlab')).toMatchObject({
      branch: 'main',
      sha: 'c2',
      message: '',
      author: '',
    });
  });

  it('collects added/modified/removed files from a GitHub payload', () => {
    const body = {
      ref: 'refs/heads/main',
      head_commit: { id: 'abc', message: 'm', added: ['x.ts'], modified: ['y.ts'] },
      commits: [
        { id: 'c1', added: ['a.ts'], modified: [], removed: [] },
        { id: 'c2', added: [], modified: ['b/c.ts'], removed: ['gone.ts'] },
      ],
    };
    const result = parsePush(body, 'github');
    expect(result?.changedFiles).toEqual(['a.ts', 'b/c.ts', 'gone.ts', 'x.ts', 'y.ts']);
  });

  it('collects changed files from a GitLab payload', () => {
    const body = {
      ref: 'refs/heads/main',
      commits: [{ id: 'c1', message: 'm', added: ['one.ts'], modified: ['two.ts'], removed: ['three.ts'] }],
    };
    expect(parsePush(body, 'gitlab')?.changedFiles).toEqual(['one.ts', 'two.ts', 'three.ts']);
  });

  it('falls back to the head commit alone when the commits array is absent', () => {
    const body = {
      ref: 'refs/heads/main',
      head_commit: { id: 'abc', message: 'm', modified: ['only.ts'] },
    };
    expect(parsePush(body, 'github')?.changedFiles).toEqual(['only.ts']);
  });

  it('returns an empty changed-files list when nothing reports paths', () => {
    const body = { ref: 'refs/heads/main', head_commit: { id: 'abc', message: 'm' } };
    expect(parsePush(body, 'github')?.changedFiles).toEqual([]);
  });

  it('skips non-array and non-string entries in file lists', () => {
    const body = {
      ref: 'refs/heads/main',
      head_commit: { id: 'abc', message: 'm', added: 'not-an-array', modified: [42, 'ok.ts'], removed: null },
      commits: [{ id: 'c1', added: [{ evil: true }], modified: 'nope' }],
    };
    expect(parsePush(body, 'github')?.changedFiles).toEqual(['ok.ts']);
  });
});

describe('isPullRequest and parsePullRequest', () => {
  it('detects PR events on GitHub, Gitea, and GitLab', () => {
    expect(isPullRequest({ 'x-github-event': 'pull_request' }, 'github')).toBe(true);
    expect(isPullRequest({ 'x-gitea-event': 'pull_request' }, 'gitea')).toBe(true);
    expect(isPullRequest({ 'x-gitlab-event': 'Merge Request Hook' }, 'gitlab')).toBe(true);
    expect(isPullRequest({ 'x-github-event': 'push' }, 'github')).toBe(false);
  });

  it('parses GitHub pull request events (open, sync, reopen, close)', () => {
    const prOpen = {
      action: 'opened',
      number: 10,
      pull_request: {
        number: 10,
        title: 'New feature',
        head: { ref: 'feat', sha: 'sha1', repo: { clone_url: 'https://github.com/a/b.git' } },
        user: { login: 'octo' },
        merged: false,
      },
    };
    expect(parsePullRequest(prOpen, 'github')).toEqual({
      action: 'opened',
      prNumber: 10,
      branch: 'feat',
      sha: 'sha1',
      title: 'New feature',
      author: 'octo',
      repoUrl: 'https://github.com/a/b.git',
      merged: false,
    });

    expect(parsePullRequest({ ...prOpen, action: 'synchronize' }, 'github')?.action).toBe('synchronize');
    expect(parsePullRequest({ ...prOpen, action: 'reopened' }, 'github')?.action).toBe('reopened');
    expect(parsePullRequest({ ...prOpen, action: 'closed' }, 'github')?.action).toBe('closed');
    expect(parsePullRequest({ ...prOpen, action: 'labeled' }, 'github')).toBeNull();
    expect(parsePullRequest(null, 'github')).toBeNull();
    expect(parsePullRequest({ action: 'opened' }, 'github')).toBeNull();
    expect(parsePullRequest({ action: 'opened', pull_request: {} }, 'github')).toBeNull();
    expect(parsePullRequest({ action: 'opened', pull_request: { number: 1, head: {} } }, 'github')).toBeNull();
    expect(parsePullRequest({ pull_request: { number: 1, head: { ref: 'main' } } }, 'github')).toBeNull();
    expect(parsePullRequest({ action: 'opened', pull_request: { head: { ref: 'main' } } }, 'github')).toBeNull();
  });

  it('parses GitLab merge request events (open, update, reopen, close, merge)', () => {
    const mrOpen = {
      object_attributes: {
        iid: 22,
        action: 'open',
        source_branch: 'gl-feat',
        last_commit: { id: 'glsha', author: { name: 'dev' } },
        title: 'GL MR',
      },
      project: { git_http_url: 'https://gitlab.com/a/b.git' },
    };
    expect(parsePullRequest(mrOpen, 'gitlab')).toEqual({
      action: 'opened',
      prNumber: 22,
      branch: 'gl-feat',
      sha: 'glsha',
      title: 'GL MR',
      author: 'dev',
      repoUrl: 'https://gitlab.com/a/b.git',
      merged: false,
    });

    // Test fallbacks: last_commit_id and author name at top level
    const mrFallback = {
      object_attributes: {
        iid: 23,
        action: 'open',
        source_branch: 'gl-feat',
        last_commit_id: 'fallback-sha',
        author: { name: 'top-author' },
        title: 'Fallback',
      },
    };
    expect(parsePullRequest(mrFallback, 'gitlab')).toMatchObject({
      sha: 'fallback-sha',
      author: 'top-author',
      repoUrl: undefined,
    });

    expect(parsePullRequest({ object_attributes: { ...mrOpen.object_attributes, action: 'update' } }, 'gitlab')?.action).toBe('synchronize');
    expect(parsePullRequest({ object_attributes: { ...mrOpen.object_attributes, action: 'reopen' } }, 'gitlab')?.action).toBe('reopened');
    expect(parsePullRequest({ object_attributes: { ...mrOpen.object_attributes, action: 'close' } }, 'gitlab')?.action).toBe('closed');
    const merged = parsePullRequest({ object_attributes: { ...mrOpen.object_attributes, action: 'merge' } }, 'gitlab');
    expect(merged?.action).toBe('closed');
    expect(merged?.merged).toBe(true);
    expect(parsePullRequest({ object_attributes: { action: 'approved' } }, 'gitlab')).toBeNull();
    expect(parsePullRequest({}, 'gitlab')).toBeNull();
    expect(parsePullRequest({ object_attributes: {} }, 'gitlab')).toBeNull();
    expect(parsePullRequest({ object_attributes: { action: 'open', iid: 0 } }, 'gitlab')).toBeNull();
    expect(parsePullRequest({ object_attributes: { action: 'open', iid: 1, source_branch: '' } }, 'gitlab')).toBeNull();
  });
});

