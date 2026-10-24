import { env } from '../config/env.js';
import { getActiveMlCategories, hydrateMlSourcesCache } from '../config/ml-sources-config.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { logger } from '../utils/logger.js';
import type { RawOffer } from '../offers/types.js';
import { generateAffiliateLink, type AffiliateLinkOptions } from './affiliate-link.js';
import { fetchCategoryViaBrowser } from './browser-scraper.js';
import { ML_ITEMS_PER_PAGE } from './category-url.js';
import { mlCircuitBreaker } from './circuit-breaker.js';
import { recordScrapeLatency, recordScrapeFailure } from '../utils/metrics.js';
import {
  fetchCategoryViaHttp,
  fetchSingleCategoryPage,
  fetchSingleOffersPage,
  validateCategoryConfig,
} from './http-scraper.js';
import type { ScrapedItem } from './types.js';

const CATEGORY_CONCURRENCY = 2;

function mapToRawOffer(item: ScrapedItem): RawOffer {
  const oldPrice = item.originalPrice;
  // O percentual anunciado no card ganha do calculado: o ML trunca a divisão e
  // recalcular divergia em 1 ponto do que o cliente vê (41% virava 42%).
  // O fallback também trunca, para seguir a mesma convenção quando não há pill.
  const discount =
    item.discountPercent ??
    (oldPrice && oldPrice > item.price
      ? Math.floor(((oldPrice - item.price) / oldPrice) * 100)
      : null);

  return {
    mercadoLivreId: item.id,
    title: item.title,
    price: item.price,
    oldPrice,
    discount,
    image: item.thumbnail?.replace('-I.jpg', '-O.jpg') ?? null,
    rating: item.rating,
    soldQuantity: item.soldQuantity,
    salesRank: item.salesRank,
    seller: item.seller,
    officialStore: item.officialStore,
    bestSeller: item.bestSeller,
    permalink: item.permalink,
  };
}

function isBlockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /blocked|captcha|403|challenge/i.test(error.message);
}

async function scrapeCategory(category: string): Promise<ScrapedItem[]> {
  if (mlCircuitBreaker.isOpen()) {
    if (!env.ML_USE_BROWSER_FALLBACK) {
      throw new Error('ML circuit breaker open — HTTP scraping suspended');
    }
    logger.info({ category }, 'Circuit breaker open — skipping HTTP, using Playwright directly');
    return fetchCategoryViaBrowser(category);
  }

  try {
    const start = Date.now();
    const items = await fetchCategoryViaHttp(category);
    recordScrapeLatency(Date.now() - start);
    mlCircuitBreaker.recordSuccess();
    return items;
  } catch (httpError) {
    logger.warn({ category, httpError }, 'HTTP scrape failed');
    recordScrapeFailure();

    if (isBlockError(httpError)) {
      mlCircuitBreaker.recordFailure();
    }

    if (!env.ML_USE_BROWSER_FALLBACK) throw httpError;

    return fetchCategoryViaBrowser(category);
  }
}

export async function buildAffiliateLink(
  permalink: string,
  mercadoLivreId?: string,
  minDelayMs?: number,
  options?: AffiliateLinkOptions,
): Promise<string> {
  return generateAffiliateLink(permalink, mercadoLivreId, minDelayMs, options);
}

const MAX_SCRAPE_PAGES = 50;

export async function* iterateScrapedPages(category: string): AsyncGenerator<RawOffer[]> {
  const validation = validateCategoryConfig(category);
  if (!validation.valid) {
    logger.error({ category, reason: validation.reason }, 'Invalid ML category config');
    return;
  }

  const seen = new Map<string, ScrapedItem>();

  try {
    if (validation.listingKind === 'offers') {
      let stalePages = 0;

      for (let page = 0; page < MAX_SCRAPE_PAGES; page++) {
        const items = await fetchSingleOffersPage(validation.url, page);
        if (items.length === 0) break;

        const fresh: ScrapedItem[] = [];
        for (const item of items) {
          if (!seen.has(item.id)) {
            seen.set(item.id, item);
            fresh.push(item);
          }
        }

        logger.info(
          { category, page, scraped: items.length, fresh: fresh.length, method: 'http' },
          'Offers page scraped',
        );

        if (fresh.length === 0) {
          stalePages++;
          if (stalePages >= 2) break;
        } else {
          stalePages = 0;
          yield fresh.map(mapToRawOffer);
        }
      }
    } else {
      for (let pageNum = 0; pageNum < MAX_SCRAPE_PAGES; pageNum++) {
        const offset = pageNum * ML_ITEMS_PER_PAGE;
        const items = await fetchSingleCategoryPage(validation.url, offset);
        if (items.length === 0) break;

        const fresh: ScrapedItem[] = [];
        for (const item of items) {
          if (!seen.has(item.id)) {
            seen.set(item.id, item);
            fresh.push(item);
          }
        }

        logger.info(
          { category, page: pageNum, scraped: items.length, fresh: fresh.length, method: 'http' },
          'Category page scraped',
        );

        if (fresh.length === 0) break;
        yield fresh.map(mapToRawOffer);

        if (items.length < ML_ITEMS_PER_PAGE) break;
      }
    }
  } catch (httpError) {
    logger.warn({ category, httpError }, 'HTTP scrape failed — trying browser fallback');

    if (isBlockError(httpError)) {
      mlCircuitBreaker.recordFailure();
    }

    if (!env.ML_USE_BROWSER_FALLBACK) throw httpError;
    const items = await fetchCategoryViaBrowser(category);
    if (items.length > 0) yield items.map(mapToRawOffer);
  }
}

export async function searchConfiguredCategories(): Promise<RawOffer[]> {
  await hydrateMlSourcesCache();
  const categories = getActiveMlCategories()
    .map((category) => {
      const validation = validateCategoryConfig(category);
      if (!validation.valid) {
        logger.error({ category, reason: validation.reason }, 'Invalid ML category config');
      }
      return validation;
    })
    .filter((validation) => validation.valid);

  if (categories.length === 0) {
    logger.error('No valid ML categories configured');
    return [];
  }

  const results = await runWithConcurrency(categories, CATEGORY_CONCURRENCY, async (validation) => {
    try {
      const items = await scrapeCategory(validation.category);
      logger.info(
        {
          category: validation.category,
          type: validation.type,
          listingKind: validation.listingKind,
          count: items.length,
        },
        'Category search completed',
      );
      return items.map(mapToRawOffer);
    } catch (error) {
      logger.error({ category: validation.category, error }, 'Failed to search category');
      return [] as RawOffer[];
    }
  });

  return results.flat();
}
