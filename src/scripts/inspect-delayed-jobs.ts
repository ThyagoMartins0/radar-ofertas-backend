import { findPendingDeliveries } from '../offers/repository.js';
import { getSenderQueue, senderJobId } from '../queue/index.js';

const pending = await findPendingDeliveries();
const row = pending[0];
if (!row) {
  console.log('no pending');
  process.exit(0);
}

const queue = getSenderQueue(row.channel, row.accountId);
const job = await queue.getJob(senderJobId(row.channel, row.offerId, row.accountId));
if (!job) {
  console.log('no job for first pending');
  process.exit(0);
}

console.log('first pending job:', {
  id: job.id,
  state: await job.getState(),
  delay: job.delay,
  timestamp: job.timestamp,
  processedOn: job.processedOn,
  attemptsMade: job.attemptsMade,
  data: job.data,
});

const delayed = await queue.getJobs(['delayed'], 0, 5);
for (const j of delayed) {
  const runAt = j.timestamp + (j.delay ?? 0);
  console.log('delayed sample:', {
    id: j.id,
    offerId: j.data.offerId,
    delay: j.delay,
    timestamp: j.timestamp,
    runAt,
    now: Date.now(),
    overdueMs: Date.now() - runAt,
  });
}

await queue.close();
process.exit(0);
