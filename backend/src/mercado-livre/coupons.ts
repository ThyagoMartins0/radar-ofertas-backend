import type { BrowserContextOptions } from 'playwright';
import { getCouponsUrlFromDb } from '../config/coupons-config-store.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { withPooledBrowserContext } from './browser-pool.js';
import {
  collectCouponsFromUnknown,
  finalizeParsedCoupons,
  isLoginHtml,
  parseCouponsHtml,
  parseCouponsJson,
} from './coupon-parser.js';
import { cookiesToHeader, hasValidSession, loadStorageState } from './session.js';
import type { CouponScrapeResult, MlCoupon } from './types.js';

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

async function couponsPageUrl(): Promise<string> {
  const url = await getCouponsUrlFromDb();
  return url.split('#')[0] ?? url;
}

function couponsMissingStoreLinks(coupons: MlCoupon[]): boolean {
  return coupons.some((coupon) => coupon.status === 'available' && !coupon.storeUrl);
}

async function fetchCouponsHtml(url: string, cookieHeader: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ML_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': env.ML_SCRAPER_USER_AGENT,
        Cookie: cookieHeader,
        Referer: 'https://www.mercadolivre.com.br/afiliados/',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) return null;
    const html = await response.text();
    return isLoginHtml(html) ? null : html;
  } catch (error) {
    logger.debug({ error, url }, 'ML coupons HTML fetch failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCouponsViaHttp(): Promise<MlCoupon[] | null> {
  const state = await loadStorageState();
  if (!state || !hasValidSession(state)) return null;

  const url = await couponsPageUrl();
  const cookieHeader = cookiesToHeader(state.cookies, ['mercadolivre.com.br', 'mercadolibre.com']);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ML_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        'User-Agent': env.ML_SCRAPER_USER_AGENT,
        Cookie: cookieHeader,
        Referer: 'https://www.mercadolivre.com.br/afiliados/',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as unknown;
      const html = await fetchCouponsHtml(url, cookieHeader);
      const coupons = parseCouponsJson(data, html ?? undefined);
      return coupons.length > 0 ? coupons : null;
    }

    const html = await response.text();
    if (!response.ok) return null;

    const coupons = parseCouponsHtml(html);
    if (coupons.length > 0) return coupons;
    if (isLoginHtml(html)) return null;

    return null;
  } catch (error) {
    logger.debug({ error, url }, 'ML coupons HTTP fetch failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCouponsViaBrowser(): Promise<MlCoupon[]> {
  const state = await loadStorageState();
  const url = await getCouponsUrlFromDb();
  const collected: MlCoupon[] = [];

  return withPooledBrowserContext(
    { storageState: state ? (state as BrowserContextOptions['storageState']) : undefined },
    async (context) => {
      const page = await context.newPage();

      page.on('response', async (response) => {
        const responseUrl = response.url();
        if (!/coupon|cupom|affiliate|campaign|benefit|promo/i.test(responseUrl)) return;
        if (response.status() < 200 || response.status() >= 300) return;

        const contentType = response.headers()['content-type'] ?? '';
        if (!contentType.includes('json')) return;

        try {
          const data = (await response.json()) as unknown;
          const before = collected.length;
          collectCouponsFromUnknown(data, collected);
          if (collected.length > before) {
            logger.debug(
              { responseUrl, added: collected.length - before },
              'Coupons captured from API response',
            );
          }
        } catch {
          // resposta não-JSON
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: env.ML_HTTP_TIMEOUT_MS });
      await page.waitForTimeout(3000);

      try {
        await page.waitForSelector(
          '[class*="coupon"], [data-testid*="coupon"], [class*="cupom"], article',
          {
            timeout: 8000,
          },
        );
      } catch {
        // página pode não ter seletores conhecidos
      }

      const html = await page.content();
      collected.push(...parseCouponsHtml(html));

      if (collected.length === 0 && isLoginHtml(html)) {
        throw new Error('Sessão de afiliado necessária — conecte o Mercado Livre em Configuração.');
      }

      const embeddedState = await page.evaluate(() => {
        const globals = globalThis as unknown as Record<string, unknown>;
        return globals.__PRELOADED_STATE__ ?? globals.__NORDIC_STATE__ ?? null;
      });

      if (embeddedState) {
        collectCouponsFromUnknown(embeddedState, collected);
      }

      return finalizeParsedCoupons(collected, html);
    },
  );
}

export async function scrapeAffiliateCoupons(): Promise<CouponScrapeResult> {
  const state = await loadStorageState();
  const sessionRequired = !hasValidSession(state);

  const httpCoupons = await fetchCouponsViaHttp();
  if (httpCoupons && httpCoupons.length > 0) {
    if (!couponsMissingStoreLinks(httpCoupons) || !env.ML_USE_BROWSER_FALLBACK) {
      return {
        coupons: httpCoupons,
        source: 'http',
        scrapedAt: new Date().toISOString(),
        sessionRequired: false,
      };
    }

    logger.info('HTTP coupons missing store links — trying browser fallback');
  }

  if (!env.ML_USE_BROWSER_FALLBACK) {
    if (sessionRequired) {
      throw new Error('Sessão de afiliado necessária — conecte o Mercado Livre em Configuração.');
    }
    throw new Error(
      'Nenhum cupom encontrado via HTTP. Ative ML_USE_BROWSER_FALLBACK=true no .env.',
    );
  }

  const browserCoupons = await fetchCouponsViaBrowser();
  if (browserCoupons.length === 0) {
    if (httpCoupons && httpCoupons.length > 0) {
      return {
        coupons: httpCoupons,
        source: 'http',
        scrapedAt: new Date().toISOString(),
        sessionRequired,
      };
    }
    throw new Error(
      'Nenhum cupom encontrado. Verifique a sessão de afiliado e a URL de cupons em Configuração.',
    );
  }

  return {
    coupons: browserCoupons,
    source: 'browser',
    scrapedAt: new Date().toISOString(),
    sessionRequired,
  };
}
