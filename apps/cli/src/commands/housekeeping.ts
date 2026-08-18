import type { NineDeployClient } from '@ninedeploy/sdk';
import { fmtBytes, spinner } from '../lib/format.js';

export async function housekeepingPrune(client: NineDeployClient): Promise<void> {
  const res = await spinner('Running system prune', () => client.housekeeping.runPrune());
  console.log('  ✓ System housekeeping prune completed.');
  console.log(`    Space reclaimed: ${fmtBytes(res.freedBytes)}`);
  console.log(`    Disk used after: ${res.diskUsedPercentAfter}%`);
  if (res.details?.imagesFreed) {
    console.log(`    Images freed:    ${res.details.imagesFreed}`);
  }
}
