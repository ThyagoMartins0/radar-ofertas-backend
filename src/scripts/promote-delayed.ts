import { getEnabledAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { getEnabledChannels } from '../channels/index.js';
import { hydrateIntegrationState } from '../channels/integration-state.js';
import { getSenderQueue } from '../queue/index.js';

await hydrateIntegrationState();

let promoted = 0;
let failed = 0;

for (const channel of getEnabledChannels()) {
  for (const accountId of await getEnabledAccountIdsForChannel(channel)) {
    const queue = getSenderQueue(channel, accountId);
    const delayed = await queue.getJobs(['delayed'], 0, 500);
    console.log('delayed count', delayed.length);
    for (const job of delayed) {
      const runAt = job.timestamp + (job.delay ?? 0);
      if (Date.now() <= runAt + 30_000) continue;
      try {
        await job.promote();
        promoted++;
      } catch (error) {
        failed++;
        console.error('promote failed', job.id, error);
      }
    }
    await queue.close();
  }
}

console.log({ promoted, failed });
process.exit(0);
