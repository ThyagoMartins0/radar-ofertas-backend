import { processScheduledAutoMessages } from './auto-messages/service.js';
import { hydrateBrandCache } from './config/brand-config.js';
import { hydrateIntegrationState } from './channels/integration-state.js';
import { bootstrapCacheCoherence } from './utils/config-cache-sync.js';
import { logger } from './utils/logger.js';

const TICK_MS = 60_000;

async function main(): Promise<void> {
  logger.info('Starting auto-messages scheduler');

  await hydrateBrandCache();
  await bootstrapCacheCoherence();
  await hydrateIntegrationState();

  const tick = async (): Promise<void> => {
    await processScheduledAutoMessages().catch((error) => {
      logger.error({ error }, 'Failed to process scheduled auto messages');
    });
  };

  await tick();
  const interval = setInterval(() => void tick(), TICK_MS);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down scheduler');
    clearInterval(interval);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error({ error }, 'Scheduler process failed');
  process.exit(1);
});
