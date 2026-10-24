import type { BrowserContextOptions } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/retry.js';
import { withPooledBrowserContext } from './browser-pool.js';
import {
  cookiesToHeader,
  isSessionExpired,
  loadStorageState,
  refreshSessionCookies,
  saveStorageState,
} from './session.js';
import type { AffiliateLinkResult } from './types.js';

const CREATE_LINK_ENDPOINTS = [
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
  'https://www.mercadolivre.com.br/affiliate-program/api/v1/affiliates/createLink',
  'https://www.mercadolivre.com.br/affiliate-program/api/affiliates/createLink',
  'https://www.mercadolivre.com.br/afiliados/api/v2/createLink',
  'https://www.mercadolivre.com.br/afiliados/api/createLink',
];

const LINK_BUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/link-builder';
const AFFILIATE_LINK_DELAY_MS = 500;

const linkCache = new Map<string, string>();
let lastLinkGeneratedAt = 0;

function fallbackAffiliateLink(permalink: string, tag: string): AffiliateLinkResult {
  const { baseUrl } = env.AFFILIATE_CONFIG;

  try {
    const url = new URL(permalink);
    if (tag) {
      url.searchParams.set('matt_tool', tag);
      url.searchParams.set('matt_word', tag);
    }
    return { url: url.toString(), shortUrl: null, source: 'fallback' };
  } catch {
    const url = `${baseUrl}${permalink.startsWith('/') ? '' : '/'}${permalink}`;
    return { url, shortUrl: null, source: 'fallback' };
  }
}

function extractLinkFromItem(item: Record<string, unknown>): AffiliateLinkResult | null {
  const shortUrl =
    typeof item.short_url === 'string'
      ? item.short_url
      : typeof item.shortUrl === 'string'
        ? item.shortUrl
        : typeof item.short_link === 'string'
          ? item.short_link
          : null;

  const url =
    typeof item.long_url === 'string'
      ? item.long_url
      : typeof item.url === 'string'
        ? item.url
        : typeof item.affiliate_url === 'string'
          ? item.affiliate_url
          : typeof item.link === 'string'
            ? item.link
            : shortUrl;

  if (!url) return null;
  return { url, shortUrl, source: 'http' };
}

export function extractLinkFromResponse(data: Record<string, unknown>): AffiliateLinkResult | null {
  if (Array.isArray(data.urls)) {
    for (const entry of data.urls) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (item.error_code || item.message?.toString().includes('not allowed')) continue;
      const result = extractLinkFromItem(item);
      if (result) return result;
    }
  }

  return extractLinkFromItem(data);
}

export function buildCreateLinkBodies(permalink: string, tag: string): Record<string, unknown>[] {
  return [
    { url: permalink, urls: [permalink], tag, short_url: true },
    { url: permalink, tag, short_url: true },
    { url: permalink, tag, shorten: true },
    { urls: [permalink], tag, short_url: true },
  ];
}

async function enforceLinkRateLimit(minDelayMs = AFFILIATE_LINK_DELAY_MS): Promise<void> {
  const elapsed = Date.now() - lastLinkGeneratedAt;
  if (elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }
  lastLinkGeneratedAt = Date.now();
}

async function createLinkViaHttp(permalink: string, tag: string): Promise<AffiliateLinkResult | null> {
  const state = await loadStorageState();

  if (isSessionExpired(state)) {
    logger.warn(
      { permalink },
      'Mercado Livre affiliate session expired or missing — run npm run ml:login',
    );
    return null;
  }

  const bodies = buildCreateLinkBodies(permalink, tag);

  async function attempt(cookieHeader: string): Promise<AffiliateLinkResult | null> {
    for (const endpoint of CREATE_LINK_ENDPOINTS) {
      for (const body of bodies) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Cookie: cookieHeader,
              Origin: 'https://www.mercadolivre.com.br',
              Referer: LINK_BUILDER_URL,
              'User-Agent': env.ML_SCRAPER_USER_AGENT,
            },
            body: JSON.stringify(body),
          });

          if (response.status === 401 || response.status === 403) {
            return null;
          }

          if (!response.ok) continue;

          const data = (await response.json()) as Record<string, unknown>;
          const result = extractLinkFromResponse(data);
          if (!result) continue;

          logger.info(
            { permalink, endpoint, affiliate_source: 'http' },
            'Affiliate link generated',
          );
          return result;
        } catch (error) {
          logger.debug({ endpoint, error }, 'createLink HTTP attempt failed');
        }
      }
    }
    return null;
  }

  let cookieHeader = cookiesToHeader(state!.cookies, ['mercadolivre.com.br', 'mercadolibre.com']);
  let result = await attempt(cookieHeader);
  if (result) return result;

  const refreshed = await refreshSessionCookies();
  if (refreshed) {
    cookieHeader = cookiesToHeader(refreshed.cookies, ['mercadolivre.com.br', 'mercadolibre.com']);
    result = await attempt(cookieHeader);
    if (result) return result;
  }

  logger.warn({ permalink }, 'createLink rejected — session may be expired, run npm run ml:login');
  return null;
}

async function createLinkViaBrowser(permalink: string): Promise<AffiliateLinkResult | null> {
  const state = await loadStorageState();

  try {
    return await withPooledBrowserContext(
      { storageState: state ? (state as BrowserContextOptions['storageState']) : undefined },
      async (context) => {
        const page = await context.newPage();

        await page.goto(LINK_BUILDER_URL, {
          waitUntil: 'domcontentloaded',
          timeout: env.ML_HTTP_TIMEOUT_MS,
        });

        const urlInput = page
          .locator(
            'input[type="url"], input[placeholder*="URL"], input[placeholder*="url"], textarea, input[data-testid*="url"]',
          )
          .first();
        await urlInput.fill(permalink);

        const generateButton = page.getByRole('button', { name: /gerar|criar|generate/i }).first();
        await generateButton.click();
        await page.waitForTimeout(2000);

        const output = page
          .locator(
            'input[readonly], textarea[readonly], [data-testid*="link"], [data-testid*="short"], .link-builder__result',
          )
          .first();
        const generated =
          (await output.inputValue().catch(() => '')) || (await output.textContent()) || '';

        if (!generated.includes('mercadolivre') && !generated.includes('mercadolibre')) {
          if (
            await page
              .locator('text=/sess[aã]o|login|entrar/i')
              .isVisible()
              .catch(() => false)
          ) {
            logger.warn({ permalink }, 'Link-builder requires login — run npm run ml:login');
          }
          return null;
        }

        const isLoginPage = /login|registration|account-verification/i.test(page.url());
        if (!isLoginPage) {
          const savedState = await context.storageState();
          await saveStorageState(savedState);
        }

        const normalized = generated.trim();
        const isShort = normalized.includes('/sec/');

        logger.info({ permalink, affiliate_source: 'browser' }, 'Affiliate link generated');
        return {
          url: normalized,
          shortUrl: isShort ? normalized : null,
          source: 'browser',
        };
      },
    );
  } catch (error) {
    logger.warn({ permalink, error }, 'Browser affiliate link generation failed');
    return null;
  }
}

export interface AffiliateLinkOptions {
  /**
   * Permite abrir o Chromium como fallback. Default `true`. No caminho de envio
   * passamos `false` para nunca lançar navegador dentro da fila de envio.
   */
  allowBrowser?: boolean;
  /**
   * Se definido, devolve o link de fallback (permalink + tag) caso a geração
   * exceda este tempo em ms — evita travar a fila de envio numa sessão ML lenta.
   */
  timeoutMs?: number;
  /** Tag de afiliado ML; default: conta default ou AFFILIATE_CONFIG. */
  tag?: string;
}

async function resolveAffiliateLink(
  permalink: string,
  mercadoLivreId: string | undefined,
  minDelayMs: number | undefined,
  allowBrowser: boolean,
  tag: string,
): Promise<string> {
  if (mercadoLivreId) {
    const cached = linkCache.get(mercadoLivreId);
    if (cached) {
      logger.debug({ mercadoLivreId, affiliate_source: 'cache' }, 'Affiliate link cache hit');
      return cached;
    }
  }

  await enforceLinkRateLimit(minDelayMs);

  const httpResult = await createLinkViaHttp(permalink, tag);
  if (httpResult) {
    const link = httpResult.shortUrl ?? httpResult.url;
    if (mercadoLivreId) linkCache.set(mercadoLivreId, link);
    return link;
  }

  if (allowBrowser && env.ML_USE_BROWSER_FALLBACK) {
    const browserResult = await createLinkViaBrowser(permalink);
    if (browserResult) {
      const link = browserResult.shortUrl ?? browserResult.url;
      if (mercadoLivreId) linkCache.set(mercadoLivreId, link);
      return link;
    }
  }

  logger.warn(
    { permalink, affiliate_source: 'fallback' },
    'Using fallback affiliate link — run npm run ml:login',
  );
  const fallback = fallbackAffiliateLink(permalink, tag).url;
  if (mercadoLivreId) linkCache.set(mercadoLivreId, fallback);
  return fallback;
}

export async function generateAffiliateLink(
  permalink: string,
  mercadoLivreId?: string,
  minDelayMs?: number,
  options: AffiliateLinkOptions = {},
): Promise<string> {
  const { allowBrowser = true, timeoutMs, tag: tagOverride } = options;
  const { resolveMercadoLivreAffiliateTag } = await import('../accounts/ml-affiliate-tag.js');
  const tag = tagOverride?.trim() || (await resolveMercadoLivreAffiliateTag());

  if (!timeoutMs) {
    return resolveAffiliateLink(permalink, mercadoLivreId, minDelayMs, allowBrowser, tag);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutFallback = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(
        { permalink, timeoutMs, affiliate_source: 'fallback-timeout' },
        'Geração de link excedeu o tempo limite — usando fallback para não travar o envio',
      );
      resolve(fallbackAffiliateLink(permalink, tag).url);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      resolveAffiliateLink(permalink, mercadoLivreId, minDelayMs, allowBrowser, tag),
      timeoutFallback,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
