import {
  getOperatingHoursStart,
  getOperatingHoursEnd,
  hydrateQueueConfigCache,
} from '../../src/config/queue-config-store.js';
import { isTelegramIntegrationEnabled } from '../../src/channels/integration-state.js';
import { env } from '../../src/config/env.js';
import {
  findDeliveriesByOfferIds,
  findOffers,
  findLastSentAt,
  getOfferStats,
  type OfferStats,
} from '../../src/offers/repository.js';
import type { DeliveryRecord, OfferRecord } from '../../src/offers/types.js';
import { validateOfferCollectionReady } from '../../src/offers/service.js';
import { estimatePendingSendTimes } from '../../src/queue/sender-schedule.js';
import { enqueueOfferCollection } from '../../src/queue/index.js';
import { isWithinOperatingHours } from '../../src/utils/datetime.js';
import { type DatabaseSnapshot, withDatabase } from './db-model.js';
import { getQueuesSnapshot, type QueuesSnapshot } from './queue-model.js';
import {
  getMercadoLivreSessionStatus,
  getTelegramSessionStatus,
  getWhatsAppSessionStatus,
  type SessionStatus,
} from './session-model.js';

const emptyStats: OfferStats = { total: 0, pending: 0, sent: 0 };

export interface DashboardOfferRow {
  offer: OfferRecord;
  scheduleAt: Date | null;
  isPending: boolean;
}

export interface DashboardData {
  database: DatabaseSnapshot;
  stats: OfferStats;
  pendingOffers: DashboardOfferRow[];
  sentOffers: DashboardOfferRow[];
  deliveriesByOfferId: Map<string, DeliveryRecord[]>;
  queues: QueuesSnapshot;
  sessions: SessionStatus[];
  withinOperatingHours: boolean;
  timezone: string;
  operatingHours: { start: number; end: number };
  lastSentAt: Date | null;
  sendNowMessage?: string;
  sendNowError?: string;
  collectMessage?: string;
  collectError?: string;
}

export async function loadDashboardData(
  options: {
    sendNowMessage?: string;
    sendNowError?: string;
    collectMessage?: string;
    collectError?: string;
  } = {},
): Promise<DashboardData> {
  await hydrateQueueConfigCache();
  const { hydrateIntegrationState } = await import('../../src/channels/integration-state.js');
  await hydrateIntegrationState();
  const operatingHours = {
    start: getOperatingHoursStart(),
    end: getOperatingHoursEnd(),
  };

  const offersResult = await withDatabase(
    async () => {
      const [stats, pendingOffers, sentOffers, lastSentAt] = await Promise.all([
        getOfferStats(),
        findOffers({ sent: 'pending', limit: 6 }),
        findOffers({ sent: 'sent', limit: 4 }),
        findLastSentAt(),
      ]);

      return { stats, pendingOffers, sentOffers, lastSentAt };
    },
    {
      stats: emptyStats,
      pendingOffers: [] as OfferRecord[],
      sentOffers: [] as OfferRecord[],
      lastSentAt: null as Date | null,
    },
  );

  let pendingRows: DashboardOfferRow[] = [];
  let sentRows: DashboardOfferRow[] = [];
  let deliveriesByOfferId = new Map<string, DeliveryRecord[]>();

  if (offersResult.database.available) {
    const allOffers = [
      ...offersResult.data.pendingOffers,
      ...offersResult.data.sentOffers,
    ];
    const schedule = await estimatePendingSendTimes(
      offersResult.data.pendingOffers.map((offer) => offer.id),
    );
    pendingRows = offersResult.data.pendingOffers.map((offer) => ({
      offer,
      scheduleAt: schedule.get(offer.id) ?? null,
      isPending: true,
    }));
    sentRows = offersResult.data.sentOffers.map((offer) => ({
      offer,
      scheduleAt: offer.sentAt,
      isPending: false,
    }));
    deliveriesByOfferId = await findDeliveriesByOfferIds(allOffers.map((offer) => offer.id));
  }

  const [queues, mlSession, waSession, tgSession] = await Promise.all([
    getQueuesSnapshot(),
    getMercadoLivreSessionStatus(),
    getWhatsAppSessionStatus(),
    getTelegramSessionStatus(),
  ]);

  return {
    database: offersResult.database,
    stats: offersResult.data.stats,
    pendingOffers: pendingRows,
    sentOffers: sentRows,
    deliveriesByOfferId,
    queues,
    // O Telegram só aparece quando ligado: quem não usa o canal não deve ver um
    // status vermelho permanente de algo que escolheu não ter.
    sessions: isTelegramIntegrationEnabled() ? [mlSession, waSession, tgSession] : [mlSession, waSession],
    withinOperatingHours: isWithinOperatingHours(env.APP_TIMEZONE, {
      startHour: operatingHours.start,
      endHour: operatingHours.end,
    }),
    timezone: env.APP_TIMEZONE,
    operatingHours,
    lastSentAt: offersResult.data.lastSentAt,
    sendNowMessage: options.sendNowMessage,
    sendNowError: options.sendNowError,
    collectMessage: options.collectMessage,
    collectError: options.collectError,
  };
}

export async function handleCollectOffers(
  options: { productName?: string } = {},
): Promise<{ ok: true } | { error: string }> {
  try {
    const blocker = await validateOfferCollectionReady({
      productName: options.productName,
    });
    if (blocker) {
      return { error: blocker };
    }

    await enqueueOfferCollection({
      force: true,
      productName: options.productName,
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Falha ao enfileirar busca de anúncios';
    return { error: message };
  }
}
