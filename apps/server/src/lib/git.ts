import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

export interface CloneCreds {
  type?: string; // github | gitlab | gitea | custom
  token?: string; // PAT for HTTPS
  deployKey?: string; // SSH private key
}

function isSshUrl(url: string): boolean {
  return url.startsWith('git@') || url.startsWith('ssh://') || url.startsWith('ssh+git://');
}

/** Convert an HTTPS URL to its SSH form (git@host:path.git). */
function toSshUrl(url: string): string {
  const m = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  return m ? `git@${m[1]}:${m[2]}.git` : url;
}

/** Inject a token into an HTTPS URL as basic-auth userinfo. */
function injectToken(url: string, token: string, type?: string): string {
  const m = /^(https?:\/\/)([^/]+)(\/.*)$/.exec(url);
  if (!m) return url;
  const user = type === 'gitlab' ? 'oauth2' : 'x-access-token';
  return `${m[1]}${user}:${encodeURIComponent(token)}@${m[2]}${m[3]}`;
}

/** Hide any embedded credentials before logging. */
function maskUrl(url: string): string {
  return url.replace(/\/\/[^/@]+@/, '//***@');
}

/**
 * Ensure `dir` is a checkout of `repoUrl` at `branch` (optionally pinned to
 * `sha`). Supports private repos via an HTTPS PAT or an SSH deploy key.
 */
export async function checkoutCommit(
  repoUrl: string,
  branch: string,
  sha: string | undefined,
  dir: string,
  sink: (line: string) => void,
  creds?: CloneCreds,
): Promise<string> {
  const useKey = !!creds?.deployKey && (isSshUrl(repoUrl) || !creds?.token);
  const keyFile = path.join(path.dirname(dir), `${path.basename(dir)}.sshkey`);

  const writeKey = () => {
    mkdirSync(path.dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, creds!.deployKey!, { mode: 0o600 });
  };
  const sshCommand = `ssh -i "${keyFile}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

  let git: SimpleGit | undefined;
  try {
    if (existsSync(path.join(dir, '.git'))) {
      git = simpleGit(dir);
      // Refresh auth so rotated credentials take effect.
      if (useKey) {
        writeKey();
        await git.addConfig('core.sshCommand', sshCommand).catch(() => undefined);
      } else if (creds?.token) {
        await git.remote(['set-url', 'origin', injectToken(repoUrl, creds.token, creds.type)]).catch(() => undefined);
      }
      sink('Fetching latest…');
      await git.fetch(['--all']);
    } else {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      let cloneUrl = repoUrl;
      const opts: string[] = [];
      if (useKey) {
        writeKey();
        cloneUrl = toSshUrl(repoUrl);
        opts.push('--config', `core.sshCommand=${sshCommand}`);
        sink(`Cloning ${maskUrl(cloneUrl)} (SSH deploy key) …`);
      } else if (creds?.token) {
        cloneUrl = injectToken(repoUrl, creds.token, creds.type);
        sink(`Cloning ${maskUrl(repoUrl)} (access token) …`);
      } else {
        sink(`Cloning ${maskUrl(repoUrl)} …`);
      }
      await simpleGit().clone(cloneUrl, dir, opts);
      git = simpleGit(dir);
    }

    await git.checkout(branch);
    try {
      await git.pull('origin', branch);
    } catch {
      /* detached/empty remote is fine */
    }
    if (sha) await git.checkout(sha);

    const resolved = (await git.raw(['log', '-1', '--format=%H'])).trim() || sha || '';
    sink(`Checked out ${resolved.slice(0, 7)} on ${branch}`);
    return resolved;
  } finally {
    // Security cleanup — never leave credentials on disk or in .git/config
    // after the checkout completes (or throws).
    if (creds?.token && git) {
      // Reset origin to the tokenless URL so the access token does not persist
      // in .git/config (nor leak into later git error output).
      await git.remote(['set-url', 'origin', repoUrl]).catch(() => undefined);
    }
    if (creds?.deployKey) {
      rmSync(keyFile, { force: true });
    }
  }
}
