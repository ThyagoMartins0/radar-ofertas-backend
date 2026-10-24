import { hydrateBrandCache } from './config/brand-config.js';
import { hydrateAllSourcesCaches } from './sources/routing.js';
import { hydrateQueueConfigCache } from './config/queue-config-store.js';
import { hydrateScoreConfigCache } from './config/score-config.js';
import { closeBrowserPool } from './mercado-livre/browser-pool.js';
import { closeSenderPacingRedis } from './utils/sender-pacing.js';
import { bootstrapCacheCoherence } from './utils/config-cache-sync.js';
import { hydrateIntegrationState } from './channels/integration-state.js';
import { stopCacheInvalidationSubscriber } from './utils/cache-coherence.js';
import { closeMetricsRedis } from './utils/metrics.js';
import { startCollectorHeartbeatLoop } from './utils/redis-state.js';
import { scheduleCollectorJob, closeAllQueues } from './queue/index.js';
import { startCollectorWorker } from './jobs/collector.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Starting collector process');

  const startedAt = new Date().toISOString();
  const stopCollectorHeartbeat = startCollectorHeartbeatLoop(startedAt);

  await Promise.all([
    hydrateQueueConfigCache(),
    hydrateScoreConfigCache(),
    hydrateBrandCache(),
    hydrateAllSourcesCaches(),
    hydrateIntegrationState(),
  ]);
  await scheduleCollectorJob();
  await bootstrapCacheCoherence();
  const worker = startCollectorWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down collector');
    stopCollectorHeartbeat();
    await worker.close();
    await closeBrowserPool();
    await closeAllQueues();
    await stopCacheInvalidationSubscriber();
    await closeMetricsRedis();
    await closeSenderPacingRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error({ error }, 'Collector process failed');
  process.exit(1);
});
