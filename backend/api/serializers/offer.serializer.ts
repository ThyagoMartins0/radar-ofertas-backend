import type { OffersPageData } from '../../manager/models/offers-model.js';
import type { DeliveryRecord, OfferRecord } from '../../src/offers/types.js';

export function serializeOffer(offer: OfferRecord) {
  return {
    ...offer,
    price: Number(offer.price),
    oldPrice: offer.oldPrice != null ? Number(offer.oldPrice) : null,
    sentAt: offer.sentAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
  };
}

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

export function serializeOffersPage(data: OffersPageData) {
  const scheduleByOfferId: Record<string, string> = {};
  for (const [offerId, date] of data.scheduleByOfferId.entries()) {
    scheduleByOfferId[offerId] = date.toISOString();
  }

  const deliveriesByOfferId: Record<string, ReturnType<typeof serializeDelivery>[]> = {};
  for (const [offerId, deliveries] of data.deliveriesByOfferId.entries()) {
    deliveriesByOfferId[offerId] = deliveries.map(serializeDelivery);
  }

  return {
    database: data.database,
    offers: data.offers.map(serializeOffer),
    scheduleByOfferId,
    deliveriesByOfferId,
    filter: data.filter,
    origin: data.origin,
    destination: data.destination,
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    totalPages: data.totalPages,
    pendingCount: data.pendingCount,
    searchLimit: data.searchLimit,
    affiliateDelay: data.affiliateDelay,
  };
}

export function serializeOfferDetail(input: {
  offer: OfferRecord;
  messagePreview: string;
  coupon: string | null;
}) {
  return {
    offer: serializeOffer(input.offer),
    messagePreview: input.messagePreview,
    coupon: input.coupon,
  };
}
