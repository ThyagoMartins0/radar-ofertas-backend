import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ScrapedItem } from './types.js';

const EMBEDDED_JSON_PATTERNS = [
  /__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
  /window\.__NORDIC_CONFIG__\s*=\s*(\{[\s\S]*?\})\s*;/,
  /"results"\s*:\s*(\[[\s\S]*?\])\s*,\s*"paging"/,
];

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/[^\d,]/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseAriaLabelPrice(label: string | undefined): number | null {
  if (!label) return null;

  const withCents = label.match(/([\d.]+)\s*reais?\s*com\s*(\d+)\s*centavos/i);
  if (withCents?.[1] && withCents[2]) {
    const reais = parsePrice(withCents[1]);
    const cents = Number.parseInt(withCents[2], 10);
    if (reais !== null && Number.isFinite(cents)) return reais + cents / 100;
  }

  const simple = label.match(/([\d.]+)\s*reais?/i);
  if (simple?.[1]) return parsePrice(simple[1]);

  return null;
}

function parseMoneyFromContainer(container: cheerio.Cheerio<AnyNode>): number | null {
  const amountEl = container.find('[data-andes-money-amount="true"]').first();
  const fromAria = parseAriaLabelPrice(amountEl.attr('aria-label'));
  if (fromAria !== null) return fromAria;

  const fraction = container.find('.andes-money-amount__fraction').first().text().trim();
  const cents = container.find('.andes-money-amount__cents').first().text().trim();
  const base = parsePrice(fraction);
  if (base === null) return null;

  if (cents) {
    const parsedCents = Number.parseInt(cents, 10);
    if (Number.isFinite(parsedCents)) return base + parsedCents / 100;
  }

  return base;
}

function parseSoldNumber(baseRaw: string, multiplierRaw?: string): number | null {
  const base = Number.parseInt(baseRaw.replace(/\D/g, ''), 10);
  if (!Number.isFinite(base)) return null;
  const multiplier = multiplierRaw ? 1000 : 1;
  return base * multiplier;
}

/** Ex.: "+1000 vendidos", "1.234 vendidos", "mais de 5mil vendidos". */
export function parseSoldQuantity(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;

  const normalized = raw.toLowerCase().replace(/\./g, '');
  const segments = normalized.split(/[|•·]/).map((part) => part.trim());
  const candidates = [
    ...segments.filter((part) => /vendid[oa]s?/.test(part)),
    ...(segments.some((part) => /vendid[oa]s?/.test(part)) ? [] : [normalized]),
  ];

  for (const text of candidates) {
    const plusMatch = text.match(/\+\s*([\d,]+)\s*(mil|k)?/);
    if (plusMatch?.[1]) {
      const value = parseSoldNumber(plusMatch[1], plusMatch[2]);
      if (value !== null) return value;
    }

    const soldMatch = text.match(/([\d,]+)\s*(mil|k)?\s*vendid[oa]s?/);
    if (soldMatch?.[1]) {
      const value = parseSoldNumber(soldMatch[1], soldMatch[2]);
      if (value !== null && value > 0) return value;
    }

    const maisDeMatch = text.match(/mais de\s+([\d,]+)\s*(mil|k)?/);
    if (maisDeMatch?.[1]) {
      const value = parseSoldNumber(maisDeMatch[1], maisDeMatch[2]);
      if (value !== null) return value;
    }
  }

  return null;
}

function resolveSoldQuantity(
  rawQuantity: unknown,
  textSources: Array<string | undefined>,
): number | null {
  if (typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) && rawQuantity > 0) {
    return rawQuantity;
  }

  if (typeof rawQuantity === 'string') {
    const parsed = Number.parseInt(rawQuantity, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  for (const source of textSources) {
    const parsed = parseSoldQuantity(source);
    if (parsed !== null && parsed > 0) return parsed;
  }

  return null;
}

function parseRating(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d+[,.]\d+|\d+)/);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(value) && value <= 5 ? value : null;
}

/** Ex.: "4º em Impressoras" a partir do texto do card ou página do produto. */
export function parseSalesRankText(raw: string | undefined): string | null {
  if (!raw) return null;

  // O marcador ordinal (º/ª/°/o) é obrigatório: rankings reais aparecem como
  // "5º em Maquinas de Solda". Sem exigi-lo, os centavos do preço parcelado
  // ("ou R$ 577,30 em outros meios") virariam um falso "30º em outros meios".
  const match = raw.match(/(\d{1,3})\s*[ºª°o]\s*em\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s/&+-]{1,48})/i);
  if (!match?.[1] || !match[2]) return null;

  const category = match[2]
    .trim()
    .split(/(?=Chegará|Disponível)/i)[0]
    ?.replace(/\s*(MAIS VENDIDO|Novo|\+).*$/i, '')
    .trim();

  if (!category) return null;
  // "outros meios" vem do texto de meios de pagamento, nunca é uma categoria.
  if (/^outros\s+meios\b/i.test(category)) return null;
  return `${match[1]}º em ${category}`;
}

function parseSalesRankFromCard(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): string | null {
  const shortTexts: string[] = [];

  card.find('a, span, p, div, li').each((_, element) => {
    const value = $(element).text().trim();
    if (value.length > 0 && value.length < 80 && /\d+\s*[ºª°]\s*em\s+/i.test(value)) {
      shortTexts.push(value);
    }
  });

  for (const text of shortTexts) {
    const rank = parseSalesRankText(text);
    if (rank) return rank;
  }

  return parseSalesRankText(card.text());
}

function parseSoldQuantityFromCard(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): number | null {
  const textSources: string[] = [];
  const soldEl = card
    .find(
      '.ui-search-item__group__element--sold-quantity, .poly-component__sold-quantity, .poly-attributes__sold-quantity',
    )
    .first();
  const soldText = soldEl.text().trim();
  if (soldText) textSources.push(soldText);

  card.find('span, p, li, div').each((_, element) => {
    const value = $(element).text().trim();
    if (value.length > 0 && value.length < 80 && /vendid[oa]s?/i.test(value)) {
      textSources.push(value);
    }
  });

  return resolveSoldQuantity(undefined, textSources);
}

/**
 * O selo divide o mesmo slot (.poly-component__poly-label) com "OFERTA DO DIA" e
 * "OFERTA IMPERDÍVEL", então filtramos pelo texto em vez de pegar o label cru.
 */
const BEST_SELLER_LABEL = /^mais\s+vendido$/i;

function parseBestSellerFromCard($: cheerio.CheerioAPI, card: cheerio.Cheerio<AnyNode>): boolean {
  let found = false;
  card.find('.poly-component__poly-label').each((_, element) => {
    if (BEST_SELLER_LABEL.test($(element).text().trim())) found = true;
  });
  return found;
}

/**
 * O ML trunca o percentual ("R$ 205,90 -> R$ 119,90" = 41,77% vira "41% OFF"),
 * então preferimos o valor anunciado a recalcular — senão a mensagem diverge em
 * 1 ponto do que o cliente vê na página. O pill também é usado para frete
 * ("Chegará grátis amanhã"), daí o escopo em .poly-price__labels.
 */
function parseDiscountPercentFromCard(card: cheerio.Cheerio<AnyNode>): number | null {
  const pill = card.find('.poly-price__labels .polylabel-pill').first().text().trim();
  const match = pill.match(/(\d{1,3})\s*%/);
  if (!match?.[1]) return null;

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

function parseSellerFromCard(card: cheerio.Cheerio<AnyNode>): {
  seller: string | null;
  officialStore: boolean;
} {
  const el = card.find('.poly-component__seller').first();
  if (!el.length) return { seller: null, officialStore: false };

  // O selo de loja oficial é um <svg aria-label="Loja oficial"> dentro do span;
  // text() já o ignora, sobrando só o nome do vendedor.
  const officialStore = el.find('svg[aria-label="Loja oficial"]').length > 0;
  const seller = el
    .text()
    .replace(/\s+/g, ' ')
    .replace(/^por\s+/i, '')
    .trim();

  return { seller: seller || null, officialStore };
}

function extractSalesRankFromRecord(raw: Record<string, unknown>): string | null {
  for (const value of Object.values(raw)) {
    if (typeof value === 'string') {
      const rank = parseSalesRankText(value);
      if (rank) return rank;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          const rank = parseSalesRankText(entry);
          if (rank) return rank;
        }
        if (entry && typeof entry === 'object') {
          const rank = extractSalesRankFromRecord(entry as Record<string, unknown>);
          if (rank) return rank;
        }
      }
      continue;
    }

    if (value && typeof value === 'object') {
      const rank = extractSalesRankFromRecord(value as Record<string, unknown>);
      if (rank) return rank;
    }
  }

  return null;
}

function normalizePermalink(href: string): string {
  if (href.startsWith('http')) return href.split('#')[0] ?? href;
  return (
    `https://www.mercadolivre.com.br${href.startsWith('/') ? '' : '/'}${href}`.split('#')[0] ?? href
  );
}

function extractIdFromPermalink(permalink: string): string | null {
  const match = permalink.match(/(MLB-?\d+)/i);
  return match ? match[1].replace('-', '') : null;
}

function mapJsonItem(raw: Record<string, unknown>): ScrapedItem | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const title = typeof raw.title === 'string' ? raw.title : null;
  const price = typeof raw.price === 'number' ? raw.price : parsePrice(String(raw.price ?? ''));
  const permalink =
    typeof raw.permalink === 'string'
      ? raw.permalink
      : typeof raw.url === 'string'
        ? raw.url
        : null;

  if (!id || !title || price === null || !permalink) return null;

  const originalPrice =
    typeof raw.original_price === 'number'
      ? raw.original_price
      : typeof raw.original_price === 'string'
        ? parsePrice(raw.original_price)
        : null;

  const thumbnail =
    typeof raw.thumbnail === 'string'
      ? raw.thumbnail
      : typeof raw.picture === 'string'
        ? raw.picture
        : null;

  const reviews = raw.reviews as { rating_average?: number } | undefined;
  const rating =
    typeof reviews?.rating_average === 'number'
      ? reviews.rating_average
      : typeof raw.rating === 'number'
        ? raw.rating
        : null;

  const soldQuantity = resolveSoldQuantity(raw.sold_quantity, [
    typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
  ]);

  const salesRank =
    parseSalesRankText(typeof raw.subtitle === 'string' ? raw.subtitle : undefined) ??
    extractSalesRankFromRecord(raw);

  // seller/officialStore/bestSeller só têm origem conhecida no HTML do card
  // (.poly-component__seller e .poly-component__poly-label). O formato dos blobs
  // JSON do ML não foi verificado, então não chutamos nomes de chave aqui.
  return {
    id,
    title,
    price,
    originalPrice,
    thumbnail,
    permalink: normalizePermalink(permalink),
    soldQuantity,
    salesRank,
    rating,
    seller: null,
    officialStore: false,
    bestSeller: false,
    discountPercent: null,
  };
}

function extractItemsFromJsonBlob(blob: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  try {
    const parsed = JSON.parse(blob) as unknown;
    collectItemsFromUnknown(parsed, items);
  } catch {
    // JSON parcial ou inválido — ignorar
  }

  return items;
}

function collectItemsFromUnknown(node: unknown, items: ScrapedItem[]): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const entry of node) collectItemsFromUnknown(entry, items);
    return;
  }

  const record = node as Record<string, unknown>;

  if (Array.isArray(record.results)) {
    for (const result of record.results) {
      if (result && typeof result === 'object') {
        const mapped = mapJsonItem(result as Record<string, unknown>);
        if (mapped) items.push(mapped);
      }
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectItemsFromUnknown(value, items);
  }
}

function parseWithCheerio(html: string): ScrapedItem[] {
  const $ = cheerio.load(html);
  const items: ScrapedItem[] = [];

  $('.ui-search-layout__item, .poly-card').each((_, element) => {
    const card = $(element);
    const titleEl = card
      .find('h2, .poly-card__title, .poly-component__title, .ui-search-item__title')
      .first();
    const linkEl = card.find('a[href*="mercadolivre"]').first();
    const currentPriceEl = card.find('.poly-price__current').first();
    const oldPriceEl = card
      .find('s.andes-money-amount, .poly-price__labels s, .poly-price__original')
      .first();
    const imageEl = card.find('img').first();
    const ratingEl = card
      .find(
        '.ui-search-reviews__rating-number, .poly-reviews__rating, .poly-component__review-compacted',
      )
      .first();

    const href = linkEl.attr('href');
    const price = currentPriceEl.length
      ? parseMoneyFromContainer(currentPriceEl)
      : parseMoneyFromContainer(card.find('.andes-money-amount').first());
    const title =
      titleEl.text().trim() ||
      linkEl.attr('aria-label')?.trim() ||
      imageEl.attr('alt')?.trim() ||
      '';
    if (!title || !href || price === null) return;

    const permalink = normalizePermalink(href);
    const id = extractIdFromPermalink(permalink) ?? permalink;
    const originalPrice = oldPriceEl.length ? parseMoneyFromContainer(oldPriceEl) : null;
    const thumbnail = imageEl.attr('src') ?? imageEl.attr('data-src') ?? null;
    const soldQuantity = parseSoldQuantityFromCard($, card);
    const rating = parseRating(
      ratingEl.text().trim() || card.find('[aria-label*="estrela"]').attr('aria-label'),
    );
    const salesRank = parseSalesRankFromCard($, card);
    const { seller, officialStore } = parseSellerFromCard(card);
    const bestSeller = parseBestSellerFromCard($, card);
    const discountPercent = parseDiscountPercentFromCard(card);

    items.push({
      id,
      title,
      price,
      originalPrice,
      thumbnail,
      permalink,
      soldQuantity,
      salesRank,
      rating,
      seller,
      officialStore,
      bestSeller,
      discountPercent,
    });
  });

  return items;
}

export function parseListingHtml(html: string, limit: number): ScrapedItem[] {
  const found: ScrapedItem[] = [];

  for (const pattern of EMBEDDED_JSON_PATTERNS) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    found.push(...extractItemsFromJsonBlob(match[1]));
  }

  if (found.length === 0) {
    found.push(...parseWithCheerio(html));
  }

  const unique = new Map<string, ScrapedItem>();
  for (const item of found) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }

  return [...unique.values()].slice(0, limit);
}
