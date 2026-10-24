import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stubEnv } from '../test/env-stub.js';

stubEnv({ REDIS_ENABLED: false });

describe('queue — Redis desabilitado', () => {
  it('reconcilePendingOfferSendJobs retorna 0 sem Redis', async () => {
    const { reconcilePendingOfferSendJobs } = await import('./index.js');
    assert.equal(await reconcilePendingOfferSendJobs(), 0);
  });

  it('purgeOfferSendQueueBacklog retorna zeros sem Redis', async () => {
    const { purgeOfferSendQueueBacklog } = await import('./index.js');
    assert.deepEqual(await purgeOfferSendQueueBacklog(), { delayed: 0, waiting: 0 });
  });

  it('resetAndRequeuePendingSenderJobs retorna 0 sem Redis', async () => {
    const { resetAndRequeuePendingSenderJobs } = await import('./index.js');
    assert.equal(await resetAndRequeuePendingSenderJobs(), 0);
  });

  it('isRedisEnabled reflete ENV', async () => {
    const { isRedisEnabled } = await import('./index.js');
    assert.equal(isRedisEnabled(), false);
  });
});
