import {
  getAffiliateLinkBacklogDelayMinutesFromDb,
  getAffiliateLinkBacklogThresholdFromDb,
  getAffiliateLinkDelayMsFromDb,
  getSearchLimit,
  hydrateQueueConfigCache,
} from '../../src/config/queue-config-store.js';
import { fetchAmazonProductPage } from '../../src/amazon/http-scraper.js';
import { buildOfferAffiliateLink, shouldRefreshAmazonAffiliateLink } from '../../src/offers/affiliate-link.js';
import { detectOfferPlatform } from '../../src/offers/platform.js';
import {
  countOffers,
  findDeliveriesByOfferIds,
  findOfferById,
  findOffers,
  getOfferStats,
  updateOfferAffiliateLink,
  updateOfferMarketInsights,
  type OfferDestinationFilter,
  type OfferOriginFilter,
  type OfferSentFilter,
} from '../../src/offers/repository.js';
import type { DeliveryRecord, OfferRecord } from '../../src/offers/types.js';
import { estimatePendingSendTimes } from '../../src/queue/sender-schedule.js';
import { logger } from '../../src/utils/logger.js';
import { type DatabaseSnapshot, withDatabase } from './db-model.js';

const PAGE_SIZE = 20;

export interface AffiliateLinkDelaySettings {
  delayMs: number;
  backlogDelayMinutes: number;
  backlogThreshold: number;
}

export interface OffersListFilters {
  status: OfferSentFilter;
  origin: OfferOriginFilter;
  destination: OfferDestinationFilter;
}

export interface OffersPageData {
  database: DatabaseSnapshot;
  offers: OfferRecord[];
  scheduleByOfferId: Map<string, Date>;
  /** Entregas por oferta (destino/canais). Vazio se o canal não recebe a oferta. */
  deliveriesByOfferId: Map<string, DeliveryRecord[]>;
  filter: OfferSentFilter;
  origin: OfferOriginFilter;
  destination: OfferDestinationFilter;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pendingCount: number;
  searchLimit: number;
  affiliateDelay: AffiliateLinkDelaySettings;
}

export function parseSentFilter(value: string | null): OfferSentFilter {
  if (value === 'pending' || value === 'sent' || value === 'error') return value;
  return 'all';
}

export function parsePage(value: string | null): number {
  const page = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export async function loadAffiliateLinkDelaySettings(): Promise<AffiliateLinkDelaySettings> {
  await hydrateQueueConfigCache();
  const [delayMs, backlogDelayMinutes, backlogThreshold] = await Promise.all([
    getAffiliateLinkDelayMsFromDb(),
    getAffiliateLinkBacklogDelayMinutesFromDb(),
    getAffiliateLinkBacklogThresholdFromDb(),
  ]);
  return { delayMs, backlogDelayMinutes, backlogThreshold };
}

export async function loadOffersPage(
  filters: OffersListFilters,
  page: number,
): Promise<OffersPageData> {
  const { status, origin, destination } = filters;
  const result = await withDatabase(
    async () => {
      const query = { sent: status, origin, destination };
      const total = await countOffers(query);
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * PAGE_SIZE;
      const offers = await findOffers({ ...query, limit: PAGE_SIZE, offset });
      const stats = await getOfferStats();
      return { offers, total, totalPages, page: safePage, pendingCount: stats.pending };
    },
    { offers: [] as OfferRecord[], total: 0, totalPages: 1, page: 1, pendingCount: 0 },
  );

  let scheduleByOfferId = new Map<string, Date>();
  let deliveriesByOfferId = new Map<string, DeliveryRecord[]>();
  const affiliateDelay = await loadAffiliateLinkDelaySettings();
  if (result.database.available) {
    if (result.data.pendingCount > 0) {
      scheduleByOfferId = await estimatePendingSendTimes();
    }
    deliveriesByOfferId = await findDeliveriesByOfferIds(result.data.offers.map((o) => o.id));
  }

  return {
    database: result.database,
    offers: result.data.offers,
    scheduleByOfferId,
    deliveriesByOfferId,
    filter: status,
    origin,
    destination,
    page: result.data.page,
    pageSize: PAGE_SIZE,
    total: result.data.total,
    totalPages: result.data.totalPages,
    pendingCount: result.data.pendingCount,
    searchLimit: getSearchLimit(),
    affiliateDelay,
  };
}

export async function loadOfferDetail(
  id: string,
): Promise<{ offer: OfferRecord | null; database: DatabaseSnapshot }> {
  const result = await withDatabase(async () => findOfferById(id), null);
  return { offer: result.data, database: result.database };
}

export interface AmazonOfferHydrationResult {
  offer: OfferRecord;
  coupon: string | null;
}

function amazonProductUrl(offer: OfferRecord): string {
  return offer.permalink ?? `https://www.amazon.com.br/dp/${offer.mercadoLivreId}`;
}

/** Enriquece oferta Amazon no painel (link afiliado + dados do PDP). */
export async function hydrateAmazonOfferRecord(
  offer: OfferRecord,
): Promise<AmazonOfferHydrationResult> {
  if (detectOfferPlatform(offer) !== 'amazon') {
    return { offer, coupon: null };
  }

  const permalink = amazonProductUrl(offer);
  let hydrated: OfferRecord = { ...offer };
  let coupon: string | null = null;

  const needsAffiliateLink =
    !offer.affiliateLink ||
    shouldRefreshAmazonAffiliateLink(permalink, offer.mercadoLivreId, offer.affiliateLink);

  if (needsAffiliateLink) {
    try {
      const affiliateLink = await buildOfferAffiliateLink(permalink, offer.mercadoLivreId);
      await updateOfferAffiliateLink(offer.id, affiliateLink);
      hydrated = { ...hydrated, affiliateLink };
    } catch (error) {
      logger.warn({ offerId: offer.id, error }, 'Falha ao gerar link afiliado Amazon no painel');
    }
  }

  const needsProductPage =
    !offer.seller ||
    offer.rating === null ||
    offer.soldQuantity === null ||
    !offer.salesRank;

  try {
    const product = await fetchAmazonProductPage(permalink);
    if (!product) return { offer: hydrated, coupon };

    coupon = product.coupon;

    if (needsProductPage) {
      const salesRank =
        product.reviewsCount !== null ? String(product.reviewsCount) : offer.salesRank;
      await updateOfferMarketInsights(offer.id, {
        rating: product.rating ?? offer.rating,
        soldQuantity: product.soldQuantity ?? offer.soldQuantity,
        salesRank,
        seller: product.seller ?? offer.seller,
      });
      hydrated = {
        ...hydrated,
        rating: product.rating ?? offer.rating,
        soldQuantity: product.soldQuantity ?? offer.soldQuantity,
        salesRank,
        seller: product.seller ?? offer.seller,
      };
    }
  } catch (error) {
    logger.warn({ offerId: offer.id, error }, 'Falha ao enriquecer oferta Amazon no painel');
  }

  return { offer: hydrated, coupon };
}
