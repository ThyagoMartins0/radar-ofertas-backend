import { Redis } from 'ioredis';

import { getEnabledAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { getEnabledChannels, isChannelEnabled } from '../channels/index.js';
import { hydrateIntegrationState } from '../channels/integration-state.js';
import { env } from '../config/env.js';
import { hydrateQueueConfigCache } from '../config/queue-config-store.js';
import { findPendingDeliveries } from '../offers/repository.js';
import {
  getSenderQueue,
  getSenderQueueName,
  senderJobId,
} from '../queue/index.js';
import { isWithinOperatingHours, msUntilOperatingWindow } from '../utils/datetime.js';
import { getWorkerHeartbeat, isWorkerHeartbeatFresh } from '../utils/redis-state.js';

async function main(): Promise<void> {
  await Promise.all([hydrateQueueConfigCache(), hydrateIntegrationState()]);

  const hours = {
    startHour: env.QUEUE_CONFIG.operatingHoursStart,
    endHour: env.QUEUE_CONFIG.operatingHoursEnd,
  };
  const inWindow = isWithinOperatingHours(env.APP_TIMEZONE, hours);

  console.log('--- diagnose send ---');
  console.log('timezone:', env.APP_TIMEZONE);
  console.log('operating hours:', hours, inWindow ? 'IN window' : 'OUTSIDE window');
  if (!inWindow) {
    console.log('ms until window:', msUntilOperatingWindow(env.APP_TIMEZONE, hours));
  }
  console.log('whatsapp enabled:', isChannelEnabled('whatsapp'));
  console.log('enabled channels:', getEnabledChannels());

  const heartbeat = await getWorkerHeartbeat('whatsapp');
  console.log(
    'worker heartbeat:',
    heartbeat,
    heartbeat ? (isWorkerHeartbeatFresh(heartbeat) ? 'FRESH' : 'STALE') : 'NONE',
  );

  const pending = await findPendingDeliveries();
  console.log('pending deliveries:', pending.length);

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    for (const channel of getEnabledChannels()) {
      const accountIds = await getEnabledAccountIdsForChannel(channel);
      for (const accountId of accountIds) {
        const queueName = getSenderQueueName(channel, accountId);
        const queue = getSenderQueue(channel, accountId);
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        );
        console.log(`queue ${queueName}:`, counts);

        const channelPending = pending.filter(
          (row) => row.channel === channel && row.accountId === accountId,
        );
        for (const row of channelPending.slice(0, 5)) {
          const job = await queue.getJob(senderJobId(channel, row.offerId, accountId));
          const state = job ? await job.getState() : 'missing';
          console.log(`  offer ${row.offerId.slice(0, 8)}… job=${state}`);
        }
      }
    }

    const keys = await redis.keys('bull:offer-sender*');
    console.log('redis bull keys:', keys.length);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
