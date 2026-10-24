import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

import { parseSoldQuantity } from '../mercado-livre/parser.js';
import { DEFAULT_AMAZON_BASE_URL } from './types.js';
import type { AmazonScrapedItem } from './types.js';
import { extractAmazonAsin } from './url.js';

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const normalized = raw
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseRating(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 5 ? value : null;
}

function parseReviewsCount(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;

  const fromLabel = raw.match(/([\d.]+)\s*(?:análises|avaliações|reviews)/i);
  if (fromLabel?.[1]) {
    const value = Number.parseInt(fromLabel[1].replace(/\./g, ''), 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const fromParen = raw.match(/\(([\d.]+)\)/);
  if (fromParen?.[1]) {
    const value = Number.parseInt(fromParen[1].replace(/\./g, ''), 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseAmazonSoldQuantity(...sources: Array<string | undefined>): number | null {
  for (const source of sources) {
    const parsed = parseSoldQuantity(source);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function extractReviewsCountFromCard(card: cheerio.Cheerio<AnyNode>): number | null {
  return parseReviewsCount(
    card.find('#acrCustomerReviewText').attr('aria-label') ??
      card.find('#acrCustomerReviewText').text() ??
      card.find('[aria-label*="Análises"], [aria-label*="avaliações"]').first().attr('aria-label'),
  );
}

function extractSoldQuantityFromCard(card: cheerio.Cheerio<AnyNode>): number | null {
  return parseAmazonSoldQuantity(
    card.find('.social-proofing-faceout-title-text').first().text(),
    card.find('#social-proofing-faceout-title-tk_bought').text(),
    card.text(),
  );
}

function normalizeAmazonText(raw: string | undefined): string {
  return raw?.replace(/\s+/g, ' ').trim() ?? '';
}

function parseAmazonSeller($: cheerio.CheerioAPI): string | null {
  const candidates = [
    $('#bylineInfo').text(),
    $('a#bylineInfo').text(),
    $('#sellerProfileTriggerId').text(),
    $('#tabular-buybox-truncate-1 .a-truncate-full').text(),
    $('#merchant-info').text(),
    $('[data-feature-name="merchantInfoFeature"] .offer-display-feature-text-message').text(),
  ];

  for (const raw of candidates) {
    const text = normalizeAmazonText(raw);
    if (!text) continue;

    const soldBy = text.match(/(?:Vendido por|Visite a (?:loja|Loja)|Marca)\s*:?\s*(.+)/i);
    if (soldBy?.[1]) return soldBy[1].trim();

    if (text.length <= 80) return text;
  }

  return null;
}

function stripCouponNoise(raw: string): string {
  return raw
    .replace(/\[[^\]]+\]\s*\{[^}]*\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAmazonCouponCode(text: string): string | null {
  const patterns = [
    /insira o código\s+([A-Z0-9]{4,20})/i,
    /cupom de desconto\s+([A-Z0-9]{4,20})/i,
    /com o cupom\s+([A-Z0-9]{4,20})/i,
    /\bcódigo\s+([A-Z0-9]{4,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }

  return null;
}

function extractAmazonCouponDiscount(text: string): string | null {
  const moneyOff = text.match(/R\$\s*(\d+(?:[,.]\d+)?)\s*off/i);
  if (moneyOff?.[1]) {
    const normalized = moneyOff[1].replace(',', '.');
    const amount = Number.parseFloat(normalized);
    if (Number.isFinite(amount)) {
      const label = Number.isInteger(amount) ? String(amount) : moneyOff[1].replace('.', ',');
      return `R$${label} off`;
    }
  }

  const percentOff = text.match(/(\d+)\s*%\s*off/i);
  if (percentOff?.[1]) return `${percentOff[1]}% off`;

  return null;
}

/** Ex.: "R$20 off - COMPRANOAPP" */
export function formatAmazonCouponLabel(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  const text = stripCouponNoise(raw);
  const code = extractAmazonCouponCode(text);
  const discount = extractAmazonCouponDiscount(text);

  if (discount && code) return `${discount} - ${code}`;
  if (discount) return discount;
  if (code) return code;

  return null;
}

function parseAmazonCoupon($: cheerio.CheerioAPI, html: string): string | null {
  const sources: string[] = [];

  const selectors = [
    '#couponBadgeRegularVpc',
    '#couponBadgeAsinDetailPageCoupon',
    '#promoPriceBlockMessage_feature_div',
    '#vpcButton',
    '[data-feature-name="couponBadge"]',
    '.couponBadge',
    '[id*="couponBadge"]',
  ];

  for (const selector of selectors) {
    const text = normalizeAmazonText($(selector).first().text());
    if (text) sources.push(text);
  }

  const cleanedHtml = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  sources.push(cleanedHtml);

  return formatAmazonCouponLabel(sources.join(' '));
}

function normalizePermalink(href: string): string {
  if (href.startsWith('http')) return href.split('#')[0] ?? href;
  const base = DEFAULT_AMAZON_BASE_URL.replace(/\/$/, '');
  return `${base}${href.startsWith('/') ? '' : '/'}${href}`.split('#')[0] ?? href;
}

function parsePriceFromContainer(container: cheerio.Cheerio<AnyNode>): {
  price: number | null;
  originalPrice: number | null;
} {
  const offscreenNodes = container.find('.a-price .a-offscreen');
  const offscreenPrices: number[] = [];
  for (let index = 0; index < offscreenNodes.length; index++) {
    const price = parsePrice(offscreenNodes.eq(index).text());
    if (price !== null) offscreenPrices.push(price);
  }

  const strikePrice = parsePrice(
    container.find('.a-price.a-text-price .a-offscreen').first().text(),
  );

  const price = offscreenPrices[0] ?? null;
  const originalPrice =
    strikePrice && price !== null && strikePrice > price ? strikePrice : offscreenPrices[1] ?? null;

  return { price, originalPrice };
}

function parseListingCard(
  card: cheerio.Cheerio<AnyNode>,
  asin: string,
): AmazonScrapedItem | null {
  const title =
    card.find('h2 a span').first().text().trim() ||
    card.find('h2 span').first().text().trim() ||
    card.find('.a-text-normal').first().text().trim() ||
    card.find('img').first().attr('alt')?.trim() ||
    '';

  const href = card.find('a[href*="/dp/"]').first().attr('href') ?? `/dp/${asin}`;
  const { price, originalPrice } = parsePriceFromContainer(card);

  if (!title || price === null) return null;

  const thumbnail =
    card.find('img.s-image').first().attr('src') ??
    card.find('img[data-image-latency]').first().attr('src') ??
    null;

  const rating = parseRating(
    card.find('[aria-label*="estrelas"]').first().attr('aria-label') ??
      card.find('.a-icon-alt').first().text(),
  );
  const reviewsCount = extractReviewsCountFromCard(card);
  const soldQuantity = extractSoldQuantityFromCard(card);

  const bestSeller =
    card.text().includes('Escolha da Amazon') ||
    card.find('[aria-label="Escolha da Amazon"]').length > 0;

  return {
    asin: asin.toUpperCase(),
    title,
    price,
    originalPrice,
    thumbnail,
    permalink: normalizePermalink(href),
    rating,
    reviewsCount,
    soldQuantity,
    seller: null,
    coupon: null,
    bestSeller,
  };
}

function parseJsonLdProduct(html: string): AmazonScrapedItem | null {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        if (record['@type'] !== 'Product' && record['@type'] !== 'http://schema.org/Product')
          continue;

        const name = typeof record.name === 'string' ? record.name.trim() : null;
        const image =
          typeof record.image === 'string'
            ? record.image
            : Array.isArray(record.image) && typeof record.image[0] === 'string'
              ? record.image[0]
              : null;

        const offers = record.offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const price =
          offer && typeof offer === 'object'
            ? parsePrice(String((offer as Record<string, unknown>).price ?? ''))
            : null;

        const asin =
          extractAmazonAsin(
            typeof record.url === 'string' ? record.url : typeof record.sku === 'string' ? record.sku : '',
          ) ?? extractAmazonAsin(html);

        if (!asin || !name || price === null) continue;

        return {
          asin,
          title: name,
          price,
          originalPrice: null,
          thumbnail: image,
          permalink: `https://www.amazon.com.br/dp/${asin}`,
          rating: null,
          reviewsCount: null,
          soldQuantity: null,
          seller: null,
          coupon: null,
          bestSeller: false,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** Cards de browse node / vitrines DCL (sem data-asin). */
function parseDclProductCards($: cheerio.CheerioAPI, limit = 50): AmazonScrapedItem[] {
  const items: AmazonScrapedItem[] = [];
  const seen = new Set<string>();

  $('.dcl-product').each((_, element) => {
    if (items.length >= limit) return false;

    const card = $(element);
    const href = card.find('a[href*="/dp/"]').first().attr('href') ?? '';
    const asin = extractAmazonAsin(href);
    if (!asin || seen.has(asin)) return;

    const title =
      card.find('img').first().attr('alt')?.trim() ||
      card.find('.dcl-truncate').first().text().trim() ||
      card.find('a.dcl-product-link').attr('aria-label')?.trim() ||
      card.find('a[href*="/dp/"]').first().text().trim() ||
      '';

    const price =
      parsePrice(card.find('.dcl-product-price-new').first().text()) ??
      parsePrice(card.find('.a-price .a-offscreen').first().text());

    const originalPrice =
      parsePrice(card.find('.dcl-product-price-old').first().text()) ??
      parsePrice(card.find('.a-text-price .a-offscreen').first().text());

    if (!title || price === null) return;

    const thumbnail = card.find('img').first().attr('src') ?? null;
    const rating = parseRating(
      card.find('[aria-label*="estrelas"]').first().attr('aria-label') ??
        card.find('.a-icon-alt').first().text(),
    );
    const reviewsCount = extractReviewsCountFromCard(card);
    const soldQuantity = extractSoldQuantityFromCard(card);

    seen.add(asin);
    items.push({
      asin,
      title,
      price,
      originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
      thumbnail,
      permalink: normalizePermalink(href || `/dp/${asin}`),
      rating,
      reviewsCount,
      soldQuantity,
      seller: null,
      coupon: null,
      bestSeller: card.text().includes('Escolha da Amazon'),
    });
  });

  return items;
}

function parseSearchResultCards($: cheerio.CheerioAPI, limit = 50): AmazonScrapedItem[] {
  const items: AmazonScrapedItem[] = [];
  const seen = new Set<string>();

  $('[data-asin]').each((_, element) => {
    if (items.length >= limit) return false;

    const card = $(element);
    const asin = (card.attr('data-asin') ?? '').trim().toUpperCase();
    if (!asin || asin === '0' || seen.has(asin)) return;

    const componentType = card.attr('data-component-type') ?? '';
    if (
      componentType &&
      !/s-search-result|s-product-grid|sbv-product|sp-sponsored-result/i.test(componentType)
    ) {
      return;
    }

    const parsed = parseListingCard(card, asin);
    if (!parsed) return;

    seen.add(asin);
    items.push(parsed);
  });

  return items;
}

/** Extrai produtos de uma listagem Amazon (browse node, busca, etc.). */
export function parseAmazonListingHtml(html: string, limit = 50): AmazonScrapedItem[] {
  const $ = cheerio.load(html);

  const searchItems = parseSearchResultCards($, limit);
  if (searchItems.length > 0) return searchItems;

  return parseDclProductCards($, limit);
}

/** Extrai dados de uma página de produto Amazon (/dp/{ASIN}). */
export function parseAmazonProductHtml(html: string): AmazonScrapedItem | null {
  const $ = cheerio.load(html);

  const asin =
    extractAmazonAsin($('input#ASIN').attr('value') ?? '') ??
    extractAmazonAsin($('link[rel="canonical"]').attr('href') ?? '') ??
    extractAmazonAsin(html);

  const title = $('#productTitle').text().trim();
  const { price, originalPrice } = parsePriceFromContainer($('#corePrice_feature_div').length ? $('#corePrice_feature_div') : $('body'));

  if (asin && title && price !== null) {
    const thumbnail =
      $('#landingImage').attr('data-old-hires') ??
      $('#landingImage').attr('src') ??
      $('#imgTagWrapperId img').first().attr('src') ??
      null;

    const rating = parseRating(
      $('#acrPopover').attr('title') ??
        $('[data-hook="rating-out-of-text"]').first().text() ??
        $('#acrPopover span[aria-label]').first().attr('aria-label'),
    );
    const reviewsCount = parseReviewsCount(
      $('#acrCustomerReviewText').attr('aria-label') ?? $('#acrCustomerReviewText').text(),
    );
    const soldQuantity = parseAmazonSoldQuantity(
      $('.social-proofing-faceout-title-text').first().text(),
      $('#social-proofing-faceout-title-tk_bought').text(),
    );
    const seller = parseAmazonSeller($);
    const coupon = parseAmazonCoupon($, html);

    const bestSeller =
      html.includes('Escolha da Amazon') ||
      $('[id*="amazons-choice"]').length > 0 ||
      $('.ac-badge-wrapper').length > 0;

    return {
      asin,
      title,
      price,
      originalPrice,
      thumbnail,
      permalink: `https://www.amazon.com.br/dp/${asin}`,
      rating,
      reviewsCount,
      soldQuantity,
      seller,
      coupon,
      bestSeller,
    };
  }

  return parseJsonLdProduct(html);
}
