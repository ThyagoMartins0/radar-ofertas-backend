import type { BrowserContextOptions } from 'playwright';
import { env } from '../config/env.js';
import { getSearchLimit } from '../config/queue-config-store.js';
import { logger } from '../utils/logger.js';
import { withPooledBrowserContext } from './browser-pool.js';
import {
  buildCategoryListingUrl,
  buildOffersPaginatedUrl,
  maxOffersPagesForLimit,
  validateCategoryConfig,
} from './category-url.js';
import { parseListingHtml } from './parser.js';
import { loadStorageState } from './session.js';
import type { ScrapedItem } from './types.js';

function isBlockedHtml(html: string): boolean {
  return /captcha|challenge|account-verification|suspicious-traffic/i.test(html);
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

async function scrapeOffersPages(
  goto: (url: string) => Promise<string>,
  baseUrl: string,
): Promise<{ items: ScrapedItem[]; pagesFetched: number }> {
  const limit = getSearchLimit();
  const unique = new Map<string, ScrapedItem>();
  const maxPages = maxOffersPagesForLimit(limit);
  let stalePages = 0;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = buildOffersPaginatedUrl(baseUrl, page);
    const html = await goto(url);
    pagesFetched++;

    if (isBlockedHtml(html)) {
      throw new Error(`Browser blocked by anti-bot for ${url}`);
    }

    const items = parseListingHtml(html, limit);
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

  return {
    items: [...unique.values()].slice(0, limit),
    pagesFetched,
  };
}

export async function fetchCategoryViaBrowser(category: string): Promise<ScrapedItem[]> {
  const validation = validateCategoryConfig(category);
  if (!validation.valid) {
    throw new Error(`Invalid category config "${category}": ${validation.reason}`);
  }

  const state = await loadStorageState();

  return withPooledBrowserContext(
    { storageState: state ? (state as BrowserContextOptions['storageState']) : undefined },
    async (context) => {
      const page = await context.newPage();

      const gotoAndGetHtml = async (url: string): Promise<string> => {
        await page.goto(url, { waitUntil: 'networkidle', timeout: env.ML_HTTP_TIMEOUT_MS });
        await page.waitForTimeout(2500);
        logger.info({ url, method: 'browser' }, 'ML site visit');
        return page.content();
      };

      if (validation.listingKind === 'offers') {
        const { items, pagesFetched } = await scrapeOffersPages(gotoAndGetHtml, validation.url);

        if (items.length === 0) {
          throw new Error(`Browser scrape returned no products for ${validation.url}`);
        }

        logger.info(
          {
            category: validation.category,
            url: validation.url,
            count: items.length,
            pages: pagesFetched,
            listingKind: 'offers',
            method: 'browser',
          },
          'Offers page scraped',
        );
        return items;
      }

      const url = buildCategoryListingUrl(validation.category);
      const html = await gotoAndGetHtml(url);

      if (isBlockedHtml(html)) {
        throw new Error(`Browser blocked by anti-bot for ${url}`);
      }

      const items = parseListingHtml(html, getSearchLimit());

      if (items.length === 0) {
        throw new Error(`Browser scrape returned no products for ${url}`);
      }

      logger.info(
        {
          category: validation.category,
          url,
          count: items.length,
          listingKind: 'category',
          method: 'browser',
        },
        'Category scraped',
      );
      return items;
    },
  );
}
