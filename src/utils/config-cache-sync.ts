import { invalidateAccountsCache } from '../accounts/repository.js';
import { hydrateIntegrationState, invalidateIntegrationState } from '../channels/integration-state.js';
import { hydrateBrandCache, invalidateBrandCache } from '../config/brand-config.js';
import {
  hydrateAmazonConfigCache,
  invalidateAmazonConfigCache,
} from '../config/amazon-config-store.js';
import {
  hydrateCouponsConfigCache,
  invalidateCouponsConfigCache,
} from '../config/coupons-config-store.js';
import {
  hydrateAmazonSourcesCache,
  invalidateAmazonSourcesCache,
} from '../config/amazon-sources-config.js';
import { hydrateMlSourcesCache, invalidateMlSourcesCache } from '../config/ml-sources-config.js';
import {
  hydrateQueueConfigCache,
  invalidateQueueConfigCache,
} from '../config/queue-config-store.js';
import { hydrateScoreConfigCache, invalidateScoreConfigCache } from '../config/score-config.js';
import {
  publishCacheInvalidation,
  registerCacheInvalidationHandler,
  startCacheInvalidationSubscriber,
  type CacheDomain,
} from './cache-coherence.js';

export function registerConfigCacheHandlers(): void {
  registerCacheInvalidationHandler('accounts', async () => {
    invalidateAccountsCache();
    invalidateIntegrationState();
    await hydrateIntegrationState();
  });

  registerCacheInvalidationHandler('queue-config', async () => {
    invalidateQueueConfigCache();
    await hydrateQueueConfigCache();
  });

  registerCacheInvalidationHandler('score-config', async () => {
    invalidateScoreConfigCache();
    await hydrateScoreConfigCache();
  });

  registerCacheInvalidationHandler('brand-config', async () => {
    invalidateBrandCache();
    await hydrateBrandCache();
  });

  registerCacheInvalidationHandler('ml-sources', async () => {
    invalidateMlSourcesCache();
    await hydrateMlSourcesCache();
  });

  registerCacheInvalidationHandler('coupons-config', async () => {
    invalidateCouponsConfigCache();
    await hydrateCouponsConfigCache();
  });

  registerCacheInvalidationHandler('amazon-sources', async () => {
    invalidateAmazonSourcesCache();
    await hydrateAmazonSourcesCache();
  });

  registerCacheInvalidationHandler('amazon-config', async () => {
    invalidateAmazonConfigCache();
    await hydrateAmazonConfigCache();
  });
}

export async function bootstrapCacheCoherence(): Promise<void> {
  registerConfigCacheHandlers();
  await startCacheInvalidationSubscriber();
}

export async function notifyConfigCacheChange(...domains: CacheDomain[]): Promise<void> {
  await publishCacheInvalidation(...domains);
}
