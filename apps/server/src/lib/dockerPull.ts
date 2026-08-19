import { run, sleep } from './exec.js';

const SNAPSHOT_FAILURE = /extraction snapshot|target snapshot .*already exists|parent snapshot .*does not exist/i;

/** Docker/containerd snapshot errors known to be transient on Docker 29+. */
export function isTransientSnapshotFailure(lines: readonly string[]): boolean {
  return SNAPSHOT_FAILURE.test(lines.join('\n'));
}

/**
 * Pull an image with bounded recovery for containerd snapshot extraction
 * races. Other failures (auth, missing image, disk full, network policy) fail
 * immediately so retries never hide an actionable root cause.
 */
export async function pullDockerImage(
  image: string,
  log: (line: string) => void,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const lines: string[] = [];
    const sink = (line: string) => {
      lines.push(line);
      log(line);
    };
    try {
      await run('docker', ['pull', image], {}, sink);
      return;
    } catch (err) {
      if (!isTransientSnapshotFailure(lines) || attempt === maxAttempts) throw err;
      log(`Docker snapshot extraction race while pulling ${image}; retrying (${attempt + 1}/${maxAttempts})…`);
      await sleep(attempt * 2000);
    }
  }
}
