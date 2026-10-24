import { env } from '../config/env.js';
import { getSearchLimit } from '../config/queue-config-store.js';
import { isRetryableHttpStatus, retryDelayMs, sleep } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import {
  buildOffersPaginatedUrl,
  buildPaginatedListingUrl,
  listingOffsetsForLimit,
  maxOffersPagesForLimit,
  ML_ITEMS_PER_PAGE,
  validateCategoryConfig,
} from './category-url.js';
import { parseListingHtml } from './parser.js';
import type { ScrapedItem } from './types.js';

export {
  buildCategoryListingUrl,
  buildOffersPaginatedUrl,
  buildPaginatedListingUrl,
  isOffersListingUrl,
  validateCategoryConfig,
} from './category-url.js';
export type {
  CategoryConfigType,
  CategoryListingKind,
  CategoryValidation,
} from './category-url.js';

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const WARM_UP_URL = 'https://www.mercadolivre.com.br';

let warmCookieHeader: string | null = null;

async function warmUpCookies(): Promise<string> {
  if (warmCookieHeader) return warmCookieHeader;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ML_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(WARM_UP_URL, {
      headers: {
        ...DEFAULT_HEADERS,
        'User-Agent': env.ML_SCRAPER_USER_AGENT,
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      warmCookieHeader = setCookies.map((entry) => entry.split(';')[0]).join('; ');
      logger.debug({ cookieCount: setCookies.length }, 'ML cookie warm-up completed');
    }
  } catch (error) {
    logger.debug({ error }, 'ML cookie warm-up failed — continuing without cookies');
  } finally {
    clearTimeout(timeout);
  }

  return warmCookieHeader ?? '';
}

function buildRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    'User-Agent': env.ML_SCRAPER_USER_AGENT,
  };

  if (warmCookieHeader) {
    headers.Cookie = warmCookieHeader;
  }

  return headers;
}

function isBlockedHtml(html: string): boolean {
  return (
    html.length < 500 || /captcha|challenge|account-verification|suspicious-traffic/i.test(html)
  );
}

async function fetchHtmlWithRetry(url: string): Promise<string> {
  await warmUpCookies();
  const headers = buildRequestHeaders();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.ML_HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!response.ok) {
        if (isRetryableHttpStatus(response.status) && attempt < MAX_RETRY_ATTEMPTS - 1) {
          const delay = retryDelayMs(attempt, RETRY_BASE_MS);
          logger.warn(
            { url, status: response.status, attempt: attempt + 1, delay },
            'HTTP scrape retry',
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const html = await response.text();
      if (isBlockedHtml(html)) {
        if (attempt < MAX_RETRY_ATTEMPTS - 1) {
          const delay = retryDelayMs(attempt, RETRY_BASE_MS);
          logger.warn({ url, attempt: attempt + 1, delay }, 'Blocked HTML — retrying');
          await sleep(delay);
          continue;
        }
        throw new Error(`Blocked or empty HTML for ${url}`);
      }

      logger.info({ url, method: 'http', attempt: attempt + 1 }, 'ML site visit');

      return html;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        const delay = retryDelayMs(attempt, RETRY_BASE_MS);
        logger.warn(
          { url, attempt: attempt + 1, delay, error: lastError.message },
          'HTTP fetch retry',
        );
        await sleep(delay);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

async function fetchListingPage(url: string, limit: number): Promise<ScrapedItem[]> {
  const html = await fetchHtmlWithRetry(url);
  return parseListingHtml(html, limit);
}

function mergeUniqueItems(unique: Map<string, ScrapedItem>, items: ScrapedItem[]): number {
  let added = 0;
  for (const item of items) {
    if (!unique.has(item.id)) {
      unique.set(item.id, item);
      added++;
    }
  }
  return added;
}

async function fetchCategoryListingViaHttp(
  baseUrl: string,
  category: string,
): Promise<ScrapedItem[]> {
  const limit = getSearchLimit();
  const offsets = listingOffsetsForLimit(limit);
  const unique = new Map<string, ScrapedItem>();

  for (const offset of offsets) {
    const url = buildPaginatedListingUrl(baseUrl, offset);
    const items = await fetchListingPage(url, limit);

    mergeUniqueItems(unique, items);

    if (unique.size >= limit || items.length < ML_ITEMS_PER_PAGE) {
      break;
    }
  }

  const result = [...unique.values()].slice(0, limit);
  if (result.length === 0) {
    throw new Error(`No products parsed from ${baseUrl}`);
  }

  logger.info(
    {
      category,
      url: baseUrl,
      count: result.length,
      pages: offsets.length,
      listingKind: 'category',
      method: 'http',
    },
    'Category scraped',
  );
  return result;
}

async function fetchOffersListingViaHttp(
  baseUrl: string,
  category: string,
): Promise<ScrapedItem[]> {
  const limit = getSearchLimit();
  const unique = new Map<string, ScrapedItem>();
  const maxPages = maxOffersPagesForLimit(limit);
  let stalePages = 0;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = buildOffersPaginatedUrl(baseUrl, page);
    const items = await fetchListingPage(url, limit);
    pagesFetched++;

    if (items.length === 0) break;

    const added = mergeUniqueItems(unique, items);
    if (added === 0) {
      stalePages++;
      if (stalePages >= 2) break;
    } else {
      stalePages = 0;
    }

    if (unique.size >= limit) break;
  }

  const result = [...unique.values()].slice(0, limit);
  if (result.length === 0) {
    throw new Error(`No products parsed from ${baseUrl}`);
  }

  logger.info(
    {
      category,
      url: baseUrl,
      count: result.length,
      pages: pagesFetched,
      listingKind: 'offers',
      method: 'http',
    },
    'Offers page scraped',
  );
  return result;
}

export async function fetchSingleOffersPage(baseUrl: string, page: number): Promise<ScrapedItem[]> {
  const url = buildOffersPaginatedUrl(baseUrl, page);
  return fetchListingPage(url, Number.MAX_SAFE_INTEGER);
}

export async function fetchSingleCategoryPage(
  baseUrl: string,
  offset: number,
): Promise<ScrapedItem[]> {
  const url = offset > 0 ? buildPaginatedListingUrl(baseUrl, offset) : baseUrl;
  return fetchListingPage(url, Number.MAX_SAFE_INTEGER);
}

export async function fetchCategoryViaHttp(category: string): Promise<ScrapedItem[]> {
  const validation = validateCategoryConfig(category);
  if (!validation.valid) {
    throw new Error(`Invalid category config "${category}": ${validation.reason}`);
  }

  if (validation.listingKind === 'offers') {
    return fetchOffersListingViaHttp(validation.url, validation.category);
  }

  return fetchCategoryListingViaHttp(validation.url, validation.category);
}
