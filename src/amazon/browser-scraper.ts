import { getSearchLimit } from '../config/queue-config-store.js';
import { logger } from '../utils/logger.js';
import { withPooledBrowserContext } from '../mercado-livre/browser-pool.js';
import { parseAmazonListingHtml, parseAmazonProductHtml } from './parser.js';
import { buildAmazonPaginatedUrl, validateAmazonSourceConfig } from './source-url.js';
import type { AmazonScrapedItem } from './types.js';

function isBlockedHtml(html: string): boolean {
  return /captcha|validateCaptcha|account-verification|suspicious-traffic|robot check/i.test(html);
}

function mergeUniqueItems(unique: Map<string, AmazonScrapedItem>, items: AmazonScrapedItem[]): number {
  let added = 0;
  for (const item of items) {
    if (!unique.has(item.asin)) {
      unique.set(item.asin, item);
      added++;
    }
  }
  return added;
}

export async function fetchAmazonSourceViaBrowser(source: string): Promise<AmazonScrapedItem[]> {
  const validation = validateAmazonSourceConfig(source);
  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Fonte Amazon inválida');
  }

  return withPooledBrowserContext({}, async (context) => {
    const page = await context.newPage();
    const limit = getSearchLimit();

    if (validation.kind === 'product') {
      await page.goto(validation.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const html = await page.content();
      if (isBlockedHtml(html)) {
        throw new Error(`Amazon browser blocked for ${validation.url}`);
      }
      const item = parseAmazonProductHtml(html);
      return item ? [item] : [];
    }

    const unique = new Map<string, AmazonScrapedItem>();
    const maxPages = 3;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildAmazonPaginatedUrl(validation.url, pageNum);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .waitForSelector('.dcl-product, [data-asin]:not([data-asin=""])', { timeout: 15_000 })
        .catch(() => undefined);

      const html = await page.content();

      if (isBlockedHtml(html)) {
        throw new Error(`Amazon browser blocked for ${url}`);
      }

      const items = parseAmazonListingHtml(html, limit);
      if (items.length === 0) break;

      const added = mergeUniqueItems(unique, items);
      logger.info(
        { source: validation.url, page: pageNum, scraped: items.length, added },
        'Amazon listing page scraped via browser',
      );

      if (added === 0 || unique.size >= limit) break;
    }

    return [...unique.values()].slice(0, limit);
  });
}
