import { CHANNELS } from '../channels/index.js';
import { createPublisher } from '../channels/publisher-factory.js';
import { getWorkerAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { findAccount } from '../accounts/repository.js';
import { hydrateBrandCache } from '../config/brand-config.js';
import { hydrateQueueConfigCache } from '../config/queue-config-store.js';
import { hydrateScoreConfigCache } from '../config/score-config.js';
import { startSenderWorker } from '../jobs/sender.js';
import type { Worker } from 'bullmq';
import { hydrateCouponTemplateCache } from '../offers/coupon-template.js';
import { hydrateTemplateCache } from '../offers/message-template.js';
import { closeAllQueues, resetAndRequeuePendingSenderJobs, reconcilePendingOfferSendJobs, type SenderJobData } from '../queue/index.js';
import { bootstrapCacheCoherence } from '../utils/config-cache-sync.js';
import { startWhatsAppInviteResolveListener } from '../whatsapp/invite-resolve-rpc.js';
import { hydrateIntegrationState } from '../channels/integration-state.js';
import { logger } from '../utils/logger.js';
import { startWorkerHeartbeatLoop } from '../utils/redis-state.js';
import { CHANNEL_LABELS, type ChannelPublisher } from './types.js';

const PENDING_SEND_RECONCILE_MS = 60_000;

async function runPendingSendReconcile(reason: string, reset = false): Promise<void> {
  try {
    const requeued = reset
      ? await resetAndRequeuePendingSenderJobs()
      : await reconcilePendingOfferSendJobs();
    if (requeued > 0) {
      logger.info({ requeued, reason, reset }, 'Pending offer send jobs reconciled');
    }
  } catch (error) {
    logger.warn({ error, reason, reset }, 'Falha ao reconciliar jobs de envio pendentes');
  }
}

interface ActivePublisher {
  publisher: ChannelPublisher;
  bullWorker: Worker<SenderJobData>;
  stopHeartbeat: () => void;
}

/** Carrega publishers de contas elegíveis ao worker (WhatsApp inclui pareamento sem destinos). */
async function loadAllWorkerPublishers(): Promise<ChannelPublisher[]> {
  const publishers: ChannelPublisher[] = [];

  for (const channel of CHANNELS) {
    const accountIds = await getWorkerAccountIdsForChannel(channel);
    for (const accountId of accountIds) {
      const account = await findAccount(accountId, channel);
      if (!account) continue;
      if (channel === 'telegram' && !account.enabled) continue;
      publishers.push(createPublisher(account));
    }
  }

  return publishers;
}

async function verifyPublisher(publisher: ChannelPublisher): Promise<boolean> {
  const { channel, accountId } = publisher;
  const label = CHANNEL_LABELS[channel];
  const verification = await publisher.verify();

  if (!verification.ok) {
    if (verification.duplicate) {
      logger.error(
        { channel, accountId },
        `${label}: ${verification.detail} — sessão duplicada ignorada neste worker.`,
      );
      return false;
    }

    logger.error(
      { channel, accountId },
      `${label} não pôde ser verificado: ${verification.detail}`,
    );
    return false;
  }

  logger.info({ channel, accountId }, `${label} verificado — ${verification.detail}`);
  return true;
}

/**
 * Boot único do worker de envio: hidrata caches, conecta todos os canais/contas
 * habilitados e consome as filas BullMQ correspondentes no mesmo processo.
 */
export async function runUnifiedWorker(): Promise<void> {
  logger.info('Starting unified sender worker process');

  await hydrateIntegrationState();

  const publishers = await loadAllWorkerPublishers();
  if (publishers.length === 0) {
    logger.warn('Nenhum canal de envio habilitado — encerrando worker');
    process.exit(0);
  }

  await Promise.all([
    hydrateQueueConfigCache(),
    hydrateScoreConfigCache(),
    hydrateBrandCache(),
    hydrateTemplateCache(),
    hydrateCouponTemplateCache(),
    bootstrapCacheCoherence(),
  ]);

  const startedAt = new Date().toISOString();
  const active: ActivePublisher[] = [];

  for (const publisher of publishers) {
    const { channel, accountId } = publisher;
    // Heartbeat antes do verify: no WhatsApp o pareamento (QR) pode levar minutos e o
    // painel só detecta o worker via Redis. Sem isso, a API devolve idle/erro e o modal
    // fica em "Aguardando worker…" mesmo com QR já publicado.
    const stopHeartbeat = startWorkerHeartbeatLoop(channel, accountId, startedAt);
    const ok = await verifyPublisher(publisher);
    if (!ok) {
      stopHeartbeat();
      continue;
    }

    active.push({
      publisher,
      bullWorker: startSenderWorker(publisher),
      stopHeartbeat,
    });
  }

  if (active.length === 0) {
    logger.error('Nenhum canal pôde ser verificado — encerrando worker');
    process.exit(1);
  }

  logger.info(
    { channels: active.map(({ publisher }) => `${publisher.channel}:${publisher.accountId}`) },
    'Unified sender worker ready',
  );

  await runPendingSendReconcile('worker-startup', true);

  const hasWhatsApp = active.some(({ publisher }) => publisher.channel === 'whatsapp');
  const stopInviteResolveListener = hasWhatsApp ? startWhatsAppInviteResolveListener() : null;

  const reconcileTimer = setInterval(() => {
    void runPendingSendReconcile('periodic');
  }, PENDING_SEND_RECONCILE_MS);
  reconcileTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down unified sender worker');
    clearInterval(reconcileTimer);
    stopInviteResolveListener?.();
    for (const entry of active) {
      entry.stopHeartbeat();
      await entry.publisher.shutdown?.().catch(() => {});
      await entry.bullWorker.close();
    }
    await closeAllQueues();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
