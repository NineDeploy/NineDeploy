import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPing, parsePush, verifyWebhook } from '../../src/lib/webhooks.js';

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
    });
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
