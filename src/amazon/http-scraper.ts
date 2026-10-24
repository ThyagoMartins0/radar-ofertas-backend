import { env } from '../config/env.js';
import { isRetryableHttpStatus, retryDelayMs, sleep } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { parseAmazonListingHtml, parseAmazonProductHtml } from './parser.js';
import { buildAmazonPaginatedUrl, validateAmazonSourceConfig } from './source-url.js';
import type { AmazonScrapedItem } from './types.js';

export { validateAmazonSourceConfig, buildAmazonPaginatedUrl } from './source-url.js';
export type { AmazonSourceValidation, AmazonSourceKind } from './source-url.js';

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const WARM_UP_URL = 'https://www.amazon.com.br/';

let warmCookieHeader: string | null = null;

async function warmUpCookies(): Promise<string> {
  if (warmCookieHeader) return warmCookieHeader;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AMAZON_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(WARM_UP_URL, {
      headers: {
        ...DEFAULT_HEADERS,
        'User-Agent': env.AMAZON_SCRAPER_USER_AGENT,
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      warmCookieHeader = setCookies.map((entry) => entry.split(';')[0]).join('; ');
      logger.debug({ cookieCount: setCookies.length }, 'Amazon cookie warm-up completed');
    }
  } catch (error) {
    logger.debug({ error }, 'Amazon cookie warm-up failed — continuing without cookies');
  } finally {
    clearTimeout(timeout);
  }

  return warmCookieHeader ?? '';
}

function buildRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    'User-Agent': env.AMAZON_SCRAPER_USER_AGENT,
  };

  if (warmCookieHeader) {
    headers.Cookie = warmCookieHeader;
  }

  return headers;
}

function isBlockedHtml(html: string): boolean {
  return (
    html.length < 1500 ||
    /captcha|validateCaptcha|account-verification|suspicious-traffic|robot check/i.test(html)
  );
}

async function fetchHtmlWithRetry(url: string): Promise<string> {
  await warmUpCookies();
  const headers = buildRequestHeaders();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AMAZON_HTTP_TIMEOUT_MS);

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
            'Amazon HTTP scrape retry',
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const html = await response.text();
      if (isBlockedHtml(html)) {
        throw new Error(`Amazon blocked or empty response for ${url}`);
      }

      return html;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(retryDelayMs(attempt, RETRY_BASE_MS));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

export async function fetchAmazonListingPage(
  sourceUrl: string,
  page = 1,
): Promise<AmazonScrapedItem[]> {
  const validation = validateAmazonSourceConfig(sourceUrl);
  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Fonte Amazon inválida');
  }

  if (validation.kind === 'product') {
    const item = await fetchAmazonProductPage(validation.url);
    return item ? [item] : [];
  }

  const url = buildAmazonPaginatedUrl(validation.url, page);
  const html = await fetchHtmlWithRetry(url);
  return parseAmazonListingHtml(html);
}

export async function fetchAmazonProductPage(productUrl: string): Promise<AmazonScrapedItem | null> {
  const validation = validateAmazonSourceConfig(productUrl);
  if (!validation.valid || validation.kind !== 'product') {
    throw new Error(validation.reason ?? 'URL de produto Amazon inválida');
  }

  const html = await fetchHtmlWithRetry(validation.url);
  return parseAmazonProductHtml(html);
}

export async function fetchAmazonSourceViaHttp(source: string): Promise<AmazonScrapedItem[]> {
  const validation = validateAmazonSourceConfig(source);
  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Fonte Amazon inválida');
  }

  if (validation.kind === 'product') {
    const item = await fetchAmazonProductPage(validation.url);
    return item ? [item] : [];
  }

  const unique = new Map<string, AmazonScrapedItem>();
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const items = await fetchAmazonListingPage(validation.url, page);
    if (items.length === 0) break;

    for (const item of items) {
      if (!unique.has(item.asin)) unique.set(item.asin, item);
    }

    if (items.length < 10) break;
  }

  return [...unique.values()];
}
