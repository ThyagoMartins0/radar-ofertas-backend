import { env } from '../config/env.js';
import type { RawOffer } from '../offers/types.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { logger } from '../utils/logger.js';
import { fetchAmazonSourceViaBrowser } from './browser-scraper.js';
import { fetchAmazonListingPage, fetchAmazonProductPage, fetchAmazonSourceViaHttp } from './http-scraper.js';
import { validateAmazonSourceConfig } from './source-url.js';
import type { AmazonScrapedItem } from './types.js';

const MAX_SCRAPE_PAGES = 3;
const PDP_ENRICH_CONCURRENCY = 2;
function isBlockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /blocked|captcha|403|challenge|robot/i.test(error.message);
}

function mapToRawOffer(item: AmazonScrapedItem): RawOffer {
  const oldPrice = item.originalPrice;
  const discount =
    oldPrice && oldPrice > item.price
      ? Math.floor(((oldPrice - item.price) / oldPrice) * 100)
      : null;

  return {
    mercadoLivreId: item.asin,
    title: item.title,
    price: item.price,
    oldPrice,
    discount,
    image: item.thumbnail,
    rating: item.rating,
    soldQuantity: item.soldQuantity,
    salesRank: item.reviewsCount !== null ? String(item.reviewsCount) : null,
    seller: item.seller,
    officialStore: false,
    bestSeller: item.bestSeller,
    permalink: item.permalink,
  };
}

function needsProductPageEnrichment(item: AmazonScrapedItem): boolean {
  return (
    item.soldQuantity === null ||
    item.reviewsCount === null ||
    item.seller === null
  );
}

async function enrichAmazonItemFromProductPage(item: AmazonScrapedItem): Promise<AmazonScrapedItem> {
  if (!needsProductPageEnrichment(item)) return item;

  try {
    const product = await fetchAmazonProductPage(item.permalink);
    if (!product) return item;

    return {
      ...item,
      title: item.title || product.title,
      price: item.price ?? product.price,
      originalPrice: item.originalPrice ?? product.originalPrice,
      thumbnail: item.thumbnail ?? product.thumbnail,
      rating: item.rating ?? product.rating,
      reviewsCount: item.reviewsCount ?? product.reviewsCount,
      soldQuantity: item.soldQuantity ?? product.soldQuantity,
      seller: item.seller ?? product.seller,
      coupon: item.coupon ?? product.coupon,
      bestSeller: item.bestSeller || product.bestSeller,
    };
  } catch (error) {
    logger.debug({ asin: item.asin, error }, 'Amazon PDP enrichment failed');
    return item;
  }
}

async function enrichAmazonItems(items: AmazonScrapedItem[]): Promise<AmazonScrapedItem[]> {
  const toEnrich = items.filter(needsProductPageEnrichment);
  if (toEnrich.length === 0) return items;

  const enrichedByAsin = new Map<string, AmazonScrapedItem>();
  const enriched = await runWithConcurrency(toEnrich, PDP_ENRICH_CONCURRENCY, enrichAmazonItemFromProductPage);
  for (const item of enriched) enrichedByAsin.set(item.asin, item);

  return items.map((item) => enrichedByAsin.get(item.asin) ?? item);
}
async function scrapeAmazonSource(source: string): Promise<AmazonScrapedItem[]> {
  let items: AmazonScrapedItem[] = [];

  try {
    items = await fetchAmazonSourceViaHttp(source);
  } catch (httpError) {
    logger.warn({ source, httpError }, 'Amazon HTTP scrape failed');

    if (!env.AMAZON_USE_BROWSER_FALLBACK) throw httpError;
    if (!isBlockError(httpError)) throw httpError;

    return fetchAmazonSourceViaBrowser(source);
  }

  if (items.length === 0 && env.AMAZON_USE_BROWSER_FALLBACK) {
    logger.info({ source }, 'Amazon HTTP returned no items — trying browser fallback');
    items = await fetchAmazonSourceViaBrowser(source);
  }

  if (items.length > 0) {
    items = await enrichAmazonItems(items);
  }

  return items;
}
export async function* iterateAmazonScrapedPages(
  source: string,
): AsyncGenerator<RawOffer[]> {
  const validation = validateAmazonSourceConfig(source);
  if (!validation.valid) {
    logger.error({ source, reason: validation.reason }, 'Invalid Amazon source config');
    return;
  }

  const seen = new Map<string, AmazonScrapedItem>();

  try {
    if (validation.kind === 'product') {
      const items = await scrapeAmazonSource(source);
      if (items.length > 0) yield items.map(mapToRawOffer);
      return;
    }

    for (let page = 1; page <= MAX_SCRAPE_PAGES; page++) {
      let items = await fetchAmazonListingPage(validation.url, page);

      if (page === 1 && items.length === 0 && env.AMAZON_USE_BROWSER_FALLBACK) {
        logger.info({ source }, 'Amazon HTTP listing empty — trying browser fallback');
        const browserItems = await fetchAmazonSourceViaBrowser(source);
        if (browserItems.length > 0) yield browserItems.map(mapToRawOffer);
        return;
      }

      if (items.length === 0) break;

      const fresh: AmazonScrapedItem[] = [];
      for (const item of items) {
        if (!seen.has(item.asin)) {
          seen.set(item.asin, item);
          fresh.push(item);
        }
      }

      logger.info(
        { source, page, scraped: items.length, fresh: fresh.length, method: 'http' },
        'Amazon listing page scraped',
      );

      if (fresh.length === 0) break;
      const enrichedFresh = await enrichAmazonItems(fresh);
      yield enrichedFresh.map(mapToRawOffer);
      if (items.length < 10) break;
    }
  } catch (error) {
    logger.warn({ source, error }, 'Amazon scrape failed — trying browser fallback');

    if (!env.AMAZON_USE_BROWSER_FALLBACK) throw error;

    const items = await fetchAmazonSourceViaBrowser(source);
    if (items.length > 0) yield items.map(mapToRawOffer);
  }
}

export { mapToRawOffer };

export async function fetchAmazonOfferInsights(
  productUrl: string,
): Promise<
  Pick<AmazonScrapedItem, 'rating' | 'reviewsCount' | 'soldQuantity' | 'seller' | 'coupon'> | null
> {
  const item = await fetchAmazonProductPage(productUrl);
  if (!item) return null;
  return {
    rating: item.rating,
    reviewsCount: item.reviewsCount,
    soldQuantity: item.soldQuantity,
    seller: item.seller,
    coupon: item.coupon,
  };
}

export * from './types.js';
export * from './url.js';
export * from './affiliate-link.js';
