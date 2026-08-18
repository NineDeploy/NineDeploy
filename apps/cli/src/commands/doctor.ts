import os from 'node:os';
import process from 'node:process';
import type { NineDeployClient } from '../client.js';
import { loadConfig } from '../config.js';
import { c, header, kv } from '../lib/format.js';
import { getContainerState, isDockerAvailable, isServerReachable } from '../lib/serverRunner.js';

export async function doctorAction(client: NineDeployClient): Promise<void> {
  header('NineDeploy Doctor Diagnostics');

  let issues = 0;

  // 1. Environment Diagnostics
  console.log(`  ${c.bold('1. Local Environment:')}`);
  kv('Node.js', `${process.version} (${process.arch})`);
  kv('Platform', `${os.platform()} (${os.release()})`);
  console.log();

  // 2. Docker Diagnostics
  console.log(`  ${c.bold('2. Docker Daemon:')}`);
  const dockerOk = await isDockerAvailable();
  if (dockerOk) {
    kv('Docker CLI', c.green('available'));
    const container = await getContainerState('ninedeploy');
    kv('Server Container', container.exists ? (container.running ? c.green('running') : c.yellow('stopped')) : c.gray('not created'));
  } else {
    kv('Docker CLI', c.yellow('not found or daemon not running'));
  }
  console.log();

  // 3. Server Reachability
  const cfg = loadConfig();
  console.log(`  ${c.bold('3. NineDeploy Server:')}`);
  kv('Target URL', cfg.baseUrl);
  const reachable = await isServerReachable(cfg.baseUrl, 1200);
  if (reachable) {
    kv('Connectivity', c.green('connected'));
  } else {
    kv('Connectivity', c.red('unreachable'));
    issues++;
  }
  console.log();

  // 4. Authentication Check
  console.log(`  ${c.bold('4. Authentication & Credentials:')}`);
  if (!cfg.token) {
    kv('Session', c.yellow('not logged in (run `ninedeploy login` or `ninedeploy setup`)'));
  } else {
    try {
      const user = await client.auth.me();
      kv('Logged In User', `${user.email} (${user.role})`);
      kv('Token Status', c.green('valid'));
    } catch {
      kv('Token Status', c.red('invalid or expired'));
      issues++;
    }
  }
  console.log();

  // Summary
  if (issues === 0) {
    console.log(`  ${c.green('✓ All critical checks passed. NineDeploy CLI is ready.')}\n`);
  } else {
    console.log(`  ${c.yellow(`! Found ${issues} issue(s). Check the items marked in red above.`)}\n`);
  }
}
