import { spawnSync } from 'node:child_process';
import { recoverImageDirectlyFromRegistry } from '../apps/server/dist/lib/dockerPull.js';

const sourceImage = 'mysql:8.4';
const targetImage = `ninedeploy-smoke/registry-recovery:${process.pid}`;
const container = `ninedeploy-registry-recovery-smoke-${process.pid}`;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: options.quiet ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`docker ${args.join(' ')} exited ${result.status}`);
  return result.stdout?.trim() ?? '';
}

try {
  await recoverImageDirectlyFromRegistry(sourceImage, console.log, targetImage);
  docker([
    'run', '-d', '--name', container,
    '-e', 'MYSQL_ROOT_PASSWORD=ninedeploy-smoke-root',
    '-e', 'MYSQL_DATABASE=app',
    targetImage,
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync(
      'docker',
      ['exec', container, 'mysqladmin', 'ping', '-h', '127.0.0.1', '-uroot', '-pninedeploy-smoke-root', '--silent'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!ready) throw new Error('recovered MySQL image did not become ready within 120 seconds');
  console.log(`PASS: ${sourceImage} was registry-exported, Docker-imported, and reached mysqladmin ready state`);
} finally {
  try {
    docker(['rm', '-f', '-v', container], { quiet: true });
  } catch {
    // Best-effort exact smoke cleanup.
  }
  try {
    docker(['image', 'rm', '-f', targetImage], { quiet: true });
  } catch {
    // Best-effort exact smoke cleanup.
  }
}
