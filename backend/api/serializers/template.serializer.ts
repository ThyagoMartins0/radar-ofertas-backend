import type { TemplatePageData } from '../../manager/models/template-model.js';
import type { AutoMessageRecord } from '../../src/auto-messages/types.js';
import type { OfferRecord } from '../../src/offers/types.js';

function serializeAutoMessage(message: AutoMessageRecord) {
  return {
    ...message,
    scheduledAt: message.scheduledAt?.toISOString() ?? null,
    lastSentAt: message.lastSentAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function serializePreviewOffer(offer: OfferRecord | null) {
  if (!offer) return null;
  return {
    ...offer,
    price: Number(offer.price),
    oldPrice: offer.oldPrice != null ? Number(offer.oldPrice) : null,
    sentAt: offer.sentAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
  };
}

export function serializeTemplate(data: TemplatePageData) {
  return {
    database: data.database,
    offerTemplate: {
      template: data.template,
      defaultTemplate: data.defaultTemplate,
      placeholderVisibility: data.placeholderVisibility,
      previewText: data.previewText,
      previewValues: data.previewValues,
      previewOffer: serializePreviewOffer(data.previewOffer),
    },
    couponTemplate: {
      template: data.couponTemplate,
      defaultTemplate: data.defaultCouponTemplate,
      placeholderVisibility: data.couponPlaceholderVisibility,
      previewText: data.couponPreviewText,
      previewValues: data.couponPreviewValues,
    },
    autoMessages: data.autoMessages.map(serializeAutoMessage),
    autoMessagePlaceholders: data.autoMessagePlaceholders,
  };
}
