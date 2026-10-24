import { Worker, type Job } from 'bullmq';
import { hydrateBrandCache } from '../config/brand-config.js';
import { env } from '../config/env.js';
import { hydrateAllSourcesCaches } from '../sources/routing.js';
import {
  getOperatingHoursStart,
  getOperatingHoursEnd,
  hydrateQueueConfigCache,
} from '../config/queue-config-store.js';
import { hydrateIntegrationState } from '../channels/integration-state.js';
import { closeBrowserPool } from '../mercado-livre/browser-pool.js';
import { collectFromSource, orchestrateOfferCollection } from '../offers/service.js';
import { getQueueConnection, QUEUE_NAMES, type CollectorJobData } from '../queue/index.js';
import { isWithinOperatingHours } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';

/** Coleta longa com fallback Playwright — evita job sobreposto se o ciclo atrasar. */
const COLLECTOR_LOCK_MS = 20 * 60 * 1000;
/** Jobs de fonte distintos em paralelo (HTTP); Playwright serializado no browser-pool. */
const COLLECTOR_SOURCE_CONCURRENCY = 2;

function getOperatingHours() {
  return {
    startHour: getOperatingHoursStart(),
    endHour: getOperatingHoursEnd(),
  };
}

function resolveTriggeredAt(job: Job<CollectorJobData>): string {
  return job.data.triggeredAt;
}

/** @internal exportado para testes unitários */
export { resolveTriggeredAt };

export function startCollectorWorker(): Worker<CollectorJobData> {
  const worker = new Worker<CollectorJobData>(
    QUEUE_NAMES.OFFER_COLLECTOR,
    async (job) => {
      await Promise.all([
        hydrateQueueConfigCache(),
        hydrateAllSourcesCaches(),
        hydrateBrandCache(),
        hydrateIntegrationState(),
      ]);

      if (job.name === 'collect-source' && job.data.kind === 'source') {
        const { channel, category, quota } = job.data;
        logger.info({ jobId: job.id, channel, category, quota }, 'Collecting source shard');

        try {
          const result = await collectFromSource(channel, category, quota);
          logger.info(
            { jobId: job.id, channel, category, ...result },
            'Source collection completed',
          );
          return result;
        } finally {
          await closeBrowserPool();
        }
      }

      const operatingHours = getOperatingHours();
      const force = job.data.kind === 'orchestrate' && job.data.force === true;

      if (!force && !isWithinOperatingHours(env.APP_TIMEZONE, operatingHours)) {
        logger.info(
          {
            jobId: job.id,
            timezone: env.APP_TIMEZONE,
            operatingHours,
          },
          'Outside operating hours — skipping offer collection orchestration',
        );
        return { skipped: true, reason: 'outside_operating_hours' };
      }

      const triggeredAt = resolveTriggeredAt(job);
      const productName =
        job.data.kind === 'orchestrate' ? job.data.productName?.trim() || undefined : undefined;
      logger.info({ jobId: job.id, triggeredAt, force, productName }, 'Orchestrating offer collection');

      const { jobs } = await orchestrateOfferCollection(triggeredAt, { productName });
      return { jobs, triggeredAt };
    },
    {
      connection: getQueueConnection(),
      concurrency: COLLECTOR_SOURCE_CONCURRENCY,
      lockDuration: COLLECTOR_LOCK_MS,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error }, 'Collector job failed');
  });

  return worker;
}
