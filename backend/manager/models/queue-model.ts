import type { Queue } from 'bullmq';
import { getEnabledChannels } from '../../src/channels/index.js';
import { CHANNEL_LABELS, type Channel } from '../../src/channels/types.js';
import { getCollectorQueue, getSenderQueue, isRedisEnabled } from '../../src/queue/index.js';
import { logger } from '../../src/utils/logger.js';

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

/** Fila de envio de um canal — uma linha por canal ligado no painel. */
export interface SenderQueueSnapshot {
  channel: Channel;
  label: string;
  counts: QueueCounts;
}

export interface QueuesSnapshot {
  available: boolean;
  error?: string;
  collector: QueueCounts;
  senders: SenderQueueSnapshot[];
}

const emptyCounts = (): QueueCounts => ({
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  completed: 0,
});

async function readCounts(queue: Queue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}

export async function getQueuesSnapshot(): Promise<QueuesSnapshot> {
  if (!isRedisEnabled()) {
    return {
      available: false,
      error: 'Redis desabilitado (REDIS_ENABLED=false)',
      collector: emptyCounts(),
      senders: [],
    };
  }

  try {
    const collector = await readCounts(getCollectorQueue());
    const senders = await Promise.all(
      getEnabledChannels().map(async (channel) => ({
        channel,
        label: CHANNEL_LABELS[channel],
        counts: await readCounts(getSenderQueue(channel)),
      })),
    );

    return { available: true, collector, senders };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error }, 'Redis indisponível — filas não carregadas no manager');
    return {
      available: false,
      error: message,
      collector: emptyCounts(),
      senders: [],
    };
  }
}
