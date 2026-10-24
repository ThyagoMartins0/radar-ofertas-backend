import type { DashboardData } from '../../manager/models/dashboard-model.js';
import type { DeliveryRecord } from '../../src/offers/types.js';

function serializeDelivery(delivery: DeliveryRecord) {
  return {
    id: delivery.id,
    offerId: delivery.offerId,
    channel: delivery.channel,
    accountId: delivery.accountId,
    sentAt: delivery.sentAt?.toISOString() ?? null,
    messageId: delivery.messageId,
    error: delivery.error,
    createdAt: delivery.createdAt.toISOString(),
  };
}

function serializeOfferRow(row: DashboardData['pendingOffers'][number]) {
  return {
    offer: {
      ...row.offer,
      price: Number(row.offer.price),
      oldPrice: row.offer.oldPrice != null ? Number(row.offer.oldPrice) : null,
      sentAt: row.offer.sentAt?.toISOString() ?? null,
      createdAt: row.offer.createdAt.toISOString(),
    },
    scheduleAt: row.scheduleAt?.toISOString() ?? null,
    isPending: row.isPending,
  };
}

export function serializeDashboard(data: DashboardData) {
  const deliveriesByOfferId: Record<string, ReturnType<typeof serializeDelivery>[]> = {};
  for (const [offerId, deliveries] of data.deliveriesByOfferId.entries()) {
    deliveriesByOfferId[offerId] = deliveries.map(serializeDelivery);
  }

  return {
    database: data.database,
    stats: data.stats,
    pendingOffers: data.pendingOffers.map(serializeOfferRow),
    sentOffers: data.sentOffers.map(serializeOfferRow),
    deliveriesByOfferId,
    queues: data.queues,
    sessions: data.sessions,
    withinOperatingHours: data.withinOperatingHours,
    timezone: data.timezone,
    operatingHours: data.operatingHours,
    lastSentAt: data.lastSentAt?.toISOString() ?? null,
  };
}
