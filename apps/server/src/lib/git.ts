import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * Ensure `dir` contains a checkout of `repoUrl` at `branch` (optionally pinned
 * to `sha`) and return the resolved commit hash.
 */
export async function checkoutCommit(
  repoUrl: string,
  branch: string,
  sha: string | undefined,
  dir: string,
  sink: (line: string) => void,
): Promise<string> {
  let git: SimpleGit;
  if (existsSync(path.join(dir, '.git'))) {
    git = simpleGit(dir);
    sink('Fetching latest…');
    await git.fetch();
  } else {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    sink(`Cloning ${repoUrl} …`);
    await simpleGit().clone(repoUrl, dir);
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
}
