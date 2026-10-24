import * as cheerio from 'cheerio';
import type { MlCoupon } from './types.js';

const JSON_STATE_PATTERNS = [
  /__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
  /window\.__NORDIC_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
  /"coupons"\s*:\s*(\[[\s\S]*?\])/,
];

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return null;
}

const STORE_URL_KEYS = [
  'products_url',
  'product_url',
  'store_url',
  'seller_url',
  'listing_url',
  'container_link',
  'permalink',
  'landing_url',
  'search_url',
  'items_url',
  'container_url',
  'deeplink',
  'landing',
  'landing_page',
  'target_url',
  'action_url',
  'link',
  'url',
  'href',
] as const;

const STORE_URL_HINT =
  /lista\.mercadolivre|listado\.mercadolivre|\/_Container_|\/loja\/|\/perfil\/|\/social\/|seller_id=|_CustId_|\/pagina\/|-seller-\d+/i;

function isStoreProductUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/_Container_')) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (!/mercadolivre\.com|mercadolibre\.com/i.test(trimmed)) return false;
  if (/\/afiliados\/|\/affiliate-program\//i.test(trimmed)) return false;
  return STORE_URL_HINT.test(trimmed) || /[?&](seller_id|cust_id|nickname)=/i.test(trimmed);
}

function normalizeStoreUrl(value: string): string {
  const trimmed = value.trim().replace(/\\\//g, '/');
  let url: string;
  if (trimmed.startsWith('//')) url = `https:${trimmed}`;
  else if (trimmed.startsWith('/_Container_')) url = `https://lista.mercadolivre.com.br${trimmed}`;
  else if (trimmed.startsWith('_Container_')) url = `https://lista.mercadolivre.com.br/${trimmed}`;
  else if (trimmed.startsWith('/')) url = `https://www.mercadolivre.com.br${trimmed}`;
  else url = trimmed;
  return url.replace(/([^:]\/)\/+/g, '$1');
}

function pickSellerId(record: Record<string, unknown>): string | null {
  const value = record.seller_id ?? record.sellerId ?? record.store_id ?? record.storeId;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const direct = asString(value);
  if (direct) return direct;

  const seller = record.seller;
  if (seller && typeof seller === 'object' && !Array.isArray(seller)) {
    const sellerRecord = seller as Record<string, unknown>;
    return pickSellerId(sellerRecord) ?? asString(sellerRecord.id);
  }

  return null;
}

function extractListaLinksFromHtml(html: string): string[] {
  const normalized = html.replace(/\\\//g, '/');
  const links = new Set<string>();

  for (const match of normalized.matchAll(
    /https?:\/\/lista\.mercadolivre\.com\.br\/_Container_[^\s"'<>\\]+/gi,
  )) {
    links.add(normalizeStoreUrl(match[0]));
  }

  for (const match of normalized.matchAll(/\/_Container_[a-z0-9-]+-seller-\d+/gi)) {
    links.add(normalizeStoreUrl(match[0]));
  }

  return [...links];
}

function findUrlNearCouponInHtml(html: string, couponId: string): string | null {
  const markers = [`"id":${couponId}`, `"id":"${couponId}"`];
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx < 0) continue;
    const chunk = html.slice(Math.max(0, idx - 800), idx + 8000).replace(/\\\//g, '/');
    const match =
      chunk.match(/https?:\/\/lista\.mercadolivre\.com\.br\/_Container_[^\s"'<>"]+/i) ??
      chunk.match(/lista\.mercadolivre\.com\.br\/_Container_[^\s"'<>"]+/i);
    if (match?.[0])
      return normalizeStoreUrl(match[0].startsWith('http') ? match[0] : `https://${match[0]}`);
  }
  return null;
}

function matchListaLinkBySellerId(links: string[], sellerId: string): string | null {
  const needle = `-seller-${sellerId}`;
  return links.find((link) => link.includes(needle)) ?? null;
}

function enrichStoreUrls(coupons: MlCoupon[], html: string): MlCoupon[] {
  const listaLinks = extractListaLinksFromHtml(html);

  return coupons.map((coupon) => {
    if (coupon.storeUrl) return coupon;

    const near = findUrlNearCouponInHtml(html, coupon.id);
    if (near) return { ...coupon, storeUrl: near };

    if (coupon.sellerId) {
      const bySeller = matchListaLinkBySellerId(listaLinks, coupon.sellerId);
      if (bySeller) return { ...coupon, storeUrl: bySeller };
    }

    return coupon;
  });
}

function pickStoreUrlFromRecord(record: Record<string, unknown>): string | null {
  for (const key of STORE_URL_KEYS) {
    const value = asString(record[key]);
    if (value && isStoreProductUrl(value)) return normalizeStoreUrl(value);
  }

  for (const key of ['actions', 'buttons', 'links', 'cta']) {
    const nested = record[key];
    if (!Array.isArray(nested)) continue;
    for (const entry of nested) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const label = pickFirstString(item, ['label', 'text', 'title', 'name']) ?? '';
      const url = pickStoreUrlFromRecord(item);
      if (url && (/ver produtos|view products/i.test(label) || !label)) return url;
    }
  }

  return findStoreUrlDeep(record);
}

function findStoreUrlDeep(node: unknown, depth = 0): string | null {
  if (depth > 6 || node == null) return null;

  if (typeof node === 'string') {
    const trimmed = node.trim();
    const candidates = [trimmed, trimmed.replace(/\\\//g, '/')];
    for (const candidate of candidates) {
      if (isStoreProductUrl(candidate)) return normalizeStoreUrl(candidate);
      const match = candidate.match(/https?:\/\/[^\s"'<>\\]+/i);
      if (match?.[0] && isStoreProductUrl(match[0])) return normalizeStoreUrl(match[0]);
    }
    return null;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      const url = findStoreUrlDeep(entry, depth + 1);
      if (url) return url;
    }
    return null;
  }

  if (typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const url = findStoreUrlDeep(value, depth + 1);
      if (url) return url;
    }
  }

  return null;
}

function resolveStoreName(record: Record<string, unknown>): string | null {
  return pickFirstString(record, [
    'seller',
    'container_name',
    'store_name',
    'shop_name',
    'nickname',
  ]);
}

function normalizeStatus(raw: string | null): MlCoupon['status'] {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (/expir|vencid|inactive|inativ/i.test(lower)) return 'expired';
  if (/gerad|created|active|ativ|dispon/i.test(lower))
    return /gerad|created/i.test(lower) ? 'generated' : 'available';
  if (/available|dispon/i.test(lower)) return 'available';
  return 'unknown';
}

function mapCouponRecord(record: Record<string, unknown>, index: number): MlCoupon | null {
  if (isAffiliateCouponRecord(record)) {
    return mapAffiliateCouponRecord(record);
  }

  const title =
    pickFirstString(record, ['title', 'name', 'headline', 'coupon_name', 'couponName']) ??
    pickFirstString(record, ['benefit', 'benefit_label', 'benefitLabel']);

  if (!title) return null;

  const discountLabel =
    pickFirstString(record, [
      'discount',
      'discount_label',
      'discountLabel',
      'benefit',
      'benefit_label',
      'benefitLabel',
      'amount',
      'value',
      'saving',
    ]) ?? '';

  const code = pickFirstString(record, [
    'code',
    'coupon_code',
    'couponCode',
    'promo_code',
    'promoCode',
  ]);
  const description =
    pickFirstString(record, [
      'description',
      'subtitle',
      'detail',
      'details',
      'summary',
      'conditions',
    ]) ?? '';
  const category = pickFirstString(record, [
    'category',
    'category_name',
    'categoryName',
    'segment',
    'type',
  ]);
  const minPurchase = pickFirstString(record, [
    'min_purchase',
    'minPurchase',
    'minimum_purchase',
    'minimumPurchase',
    'min_amount',
    'minAmount',
  ]);
  const expiresAt = pickFirstString(record, [
    'expires_at',
    'expiresAt',
    'expiration_date',
    'expirationDate',
    'valid_until',
    'validUntil',
    'end_date',
    'endDate',
  ]);
  const rawStatus = pickFirstString(record, [
    'status',
    'state',
    'availability',
    'coupon_status',
    'couponStatus',
  ]);
  const id =
    pickFirstString(record, ['id', 'coupon_id', 'couponId', 'campaign_id', 'campaignId']) ??
    `${title}-${code ?? discountLabel}-${index}`;

  const hasCouponSignal =
    Boolean(code) ||
    Boolean(discountLabel) ||
    /cupom|coupon|voucher|promo|desconto/i.test(
      `${title} ${description} ${JSON.stringify(record)}`,
    );

  if (!hasCouponSignal) return null;

  return {
    id,
    title,
    description,
    discountLabel,
    code,
    category,
    minPurchase,
    expiresAt,
    storeName: null,
    storeUrl: null,
    sellerId: null,
    status: normalizeStatus(rawStatus),
    rawStatus,
  };
}

function isAffiliateCouponRecord(record: Record<string, unknown>): boolean {
  const id = record.id;
  const title = pickFirstString(record, ['title']);
  if (!title || (typeof id !== 'number' && typeof id !== 'string')) return false;

  const hasAffiliateFields =
    'expiration_date' in record ||
    'remaining_budget' in record ||
    'seller' in record ||
    'alias' in record;
  const looksLikeDiscount = /%|OFF|R\$/i.test(title);

  return hasAffiliateFields && looksLikeDiscount;
}

function resolveAffiliateCouponStatus(
  record: Record<string, unknown>,
  code: string | null,
): MlCoupon['status'] {
  const rawStatus = pickFirstString(record, ['status']);
  if (rawStatus) return normalizeStatus(rawStatus);
  if (record.in_use === true) return 'generated';
  if (code) return 'available';
  return 'unknown';
}

function mapAffiliateCouponRecord(record: Record<string, unknown>): MlCoupon {
  const discountLabel = pickFirstString(record, ['title']) ?? '';
  const storeName = resolveStoreName(record);
  const sellerId = pickSellerId(record);
  const storeUrl = pickStoreUrlFromRecord(record);
  const id = String(record.id ?? discountLabel);
  const expiresAt = pickFirstString(record, ['expiration_date', 'expires_at', 'valid_until']);
  const category = pickFirstString(record, ['category']);
  const code = pickFirstString(record, ['alias', 'code', 'coupon_code', 'couponCode']);
  const rawStatus = pickFirstString(record, ['status']);

  return {
    id,
    title: storeName || code || discountLabel,
    description: storeName ? discountLabel : '',
    discountLabel,
    code,
    category,
    minPurchase: null,
    expiresAt,
    storeName,
    storeUrl,
    sellerId,
    status: resolveAffiliateCouponStatus(record, code),
    rawStatus,
  };
}

function parseJsonArrayAt(source: string, startIndex: number): unknown[] | null {
  let pos = startIndex;
  while (pos < source.length && /\s/.test(source[pos]!)) pos += 1;
  if (source[pos] !== '[') return null;

  let depth = 0;
  const start = pos;
  let inString = false;
  let escaped = false;

  for (let i = pos; i < source.length; i += 1) {
    const ch = source[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(start, i + 1)) as unknown;
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractAffiliateCouponsFromHtml(html: string): MlCoupon[] {
  const marker = '"coupons":';
  const coupons: MlCoupon[] = [];
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const idx = html.indexOf(marker, searchFrom);
    if (idx < 0) break;

    const array = parseJsonArrayAt(html, idx + marker.length);
    searchFrom = idx + marker.length;

    if (!array) continue;

    for (const entry of array) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (!isAffiliateCouponRecord(record)) continue;
      coupons.push(mapAffiliateCouponRecord(record));
    }
  }

  return enrichCouponsWithDomHints(enrichStoreUrls(dedupeCoupons(coupons), html), html);
}

function looksLikeCouponObject(record: Record<string, unknown>): boolean {
  if (isAffiliateCouponRecord(record)) return true;

  const keys = Object.keys(record).join(' ').toLowerCase();
  const hasCouponKey = /coupon|cupom|voucher|promo|campaign|benefit/.test(keys);
  const title = pickFirstString(record, ['title', 'name', 'headline', 'coupon_name', 'couponName']);
  const code = pickFirstString(record, ['code', 'coupon_code', 'couponCode', 'alias']);
  const discount = pickFirstString(record, [
    'discount',
    'discount_label',
    'benefit',
    'amount',
    'value',
  ]);
  return Boolean(title) && (hasCouponKey || Boolean(code) || Boolean(discount));
}

export function collectCouponsFromUnknown(node: unknown, bucket: MlCoupon[]): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const entry of node) collectCouponsFromUnknown(entry, bucket);
    return;
  }

  const record = node as Record<string, unknown>;

  if (looksLikeCouponObject(record)) {
    const mapped = mapCouponRecord(record, bucket.length);
    if (mapped) bucket.push(mapped);
  }

  for (const value of Object.values(record)) {
    collectCouponsFromUnknown(value, bucket);
  }
}

function extractJsonBlobs(html: string): string[] {
  const blobs: string[] = [];
  for (const pattern of JSON_STATE_PATTERNS) {
    const match = html.match(pattern);
    if (match?.[1]) blobs.push(match[1]);
  }
  return blobs;
}

function isCouponLikeText(text: string): boolean {
  if (text.length > 400) return false;
  if (/UserMenuWidget|function\s*\(|addEventListener|mercado_pago/i.test(text)) return false;
  return /cupom|coupon|desconto|\d+\s*%|\d+\s*OFF|R\$\s*[\d.,]+/i.test(text);
}

function parseDomCoupons(html: string): MlCoupon[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const coupons: MlCoupon[] = [];
  const selectors = [
    '[data-testid*="coupon"]',
    '[class*="coupon-item"]:not([class*="skeleton"])',
    '[class*="coupon-card"]',
    '[class*="cupom"]',
  ];

  for (const selector of selectors) {
    $(selector).each((index, element) => {
      const el = $(element);
      const text = el.text().replace(/\s+/g, ' ').trim();
      if (!isCouponLikeText(text)) return;

      const title =
        el.find('h1,h2,h3,h4,[class*="title"]').first().text().trim() ||
        text
          .split('\n')
          .find((line) => line.trim().length > 3)
          ?.trim() ||
        text.slice(0, 80);

      const code =
        text.match(/(?:c[oó]digo|code)\s*:?\s*([A-Z0-9]{4,})/i)?.[1] ??
        (el.find('[class*="code"]').first().text().trim() || null);

      const discountLabel = text.match(/\d+\s*%|\d+\s*OFF|R\$\s*[\d.,]+/i)?.[0] ?? '';

      coupons.push({
        id: `dom-${selector}-${index}-${title.slice(0, 24)}`,
        title,
        description: text.length > title.length ? text : '',
        discountLabel,
        code: code || null,
        category: null,
        minPurchase: text.match(/compra m[ií]nima[^.]+/i)?.[0] ?? null,
        expiresAt: text.match(/v[aá]lid[oa][^.]+/i)?.[0] ?? null,
        storeName: text.match(/Em produtos de\s+(.+?)(?:\s+Ver produtos|$)/i)?.[1]?.trim() ?? null,
        storeUrl: null,
        sellerId: null,
        status: /gerar|dispon[ií]vel|ativar/i.test(text) ? 'available' : 'unknown',
        rawStatus: null,
      });
    });
  }

  return coupons;
}

function couponPriority(coupon: MlCoupon): number {
  const statusScore: Record<MlCoupon['status'], number> = {
    available: 40,
    unknown: 30,
    expired: 20,
    generated: 10,
  };
  const codeScore = coupon.code ? 5 : 0;
  const storeScore = coupon.storeName ? 3 : 0;
  const urlScore = coupon.storeUrl ? 2 : 0;
  const sellerScore =
    coupon.title && coupon.title !== coupon.code && coupon.title !== coupon.discountLabel ? 1 : 0;
  return (statusScore[coupon.status] ?? 0) + codeScore + storeScore + urlScore + sellerScore;
}

function mergeCouponDetails(primary: MlCoupon, secondary: MlCoupon): MlCoupon {
  const storeName = primary.storeName || secondary.storeName;
  const storeUrl = primary.storeUrl || secondary.storeUrl;
  const sellerId = primary.sellerId || secondary.sellerId;
  const code = primary.code || secondary.code;
  const expiresAt = primary.expiresAt || secondary.expiresAt;
  const category = primary.category || secondary.category;
  const minPurchase = primary.minPurchase || secondary.minPurchase;

  return {
    ...primary,
    code,
    expiresAt,
    category,
    minPurchase,
    storeName,
    storeUrl,
    sellerId,
    title: storeName || primary.title || secondary.title,
    description: storeName
      ? primary.discountLabel || secondary.discountLabel
      : primary.description || secondary.description,
  };
}

interface DomCouponHint {
  storeName: string;
  storeUrl: string | null;
  discountLabel: string | null;
}

function parseDomCouponHints(html: string): DomCouponHint[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const hints: DomCouponHint[] = [];

  const candidates = $('[class*="coupon"], [data-testid*="coupon"], [class*="cupom"], article, li');
  candidates.each((_, element) => {
    const el = $(element);
    const text = el.text().replace(/\s+/g, ' ').trim();
    if (!isCouponLikeText(text)) return;

    const storeMatch = text.match(/Em produtos de\s+(.+?)(?:\s+Ver produtos|\s+Condições|$)/i);
    if (!storeMatch?.[1]) return;

    const storeUrl =
      el
        .find('a')
        .filter((__, anchor) => /ver produtos/i.test($(anchor).text()))
        .first()
        .attr('href') ?? null;

    hints.push({
      storeName: storeMatch[1].trim(),
      storeUrl: storeUrl ? normalizeStoreUrl(storeUrl) : null,
      discountLabel: text.match(/\d+\s*%|\d+\s*OFF|R\$\s*[\d.,]+/i)?.[0] ?? null,
    });
  });

  return hints;
}

function enrichCouponsWithDomHints(coupons: MlCoupon[], html: string): MlCoupon[] {
  const hints = parseDomCouponHints(html);
  if (hints.length === 0) return coupons;

  return coupons.map((coupon) => {
    const hint =
      hints.find((entry) => coupon.storeName && entry.storeName === coupon.storeName) ??
      hints.find(
        (entry) =>
          coupon.discountLabel &&
          entry.discountLabel &&
          entry.discountLabel.replace(/\s+/g, '') === coupon.discountLabel.replace(/\s+/g, ''),
      ) ??
      hints.find((entry) => coupon.title && entry.storeName === coupon.title);

    if (!hint) return coupon;

    const storeName = coupon.storeName || hint.storeName;
    const storeUrl = coupon.storeUrl || hint.storeUrl;

    return {
      ...coupon,
      storeName,
      storeUrl,
      title: storeName || coupon.title,
    };
  });
}

function dedupeCoupons(coupons: MlCoupon[]): MlCoupon[] {
  const byId = new Map<string, MlCoupon>();
  const withoutId: MlCoupon[] = [];

  for (const coupon of coupons) {
    if (!coupon.id || coupon.id.startsWith('dom-')) {
      withoutId.push(coupon);
      continue;
    }

    const existing = byId.get(coupon.id);
    if (!existing) {
      byId.set(coupon.id, coupon);
      continue;
    }

    const winner = couponPriority(coupon) >= couponPriority(existing) ? coupon : existing;
    const loser = winner === coupon ? existing : coupon;
    byId.set(coupon.id, mergeCouponDetails(winner, loser));
  }

  const merged = [...byId.values(), ...withoutId];
  const seen = new Set<string>();
  const result: MlCoupon[] = [];

  for (const coupon of merged) {
    const key = `${coupon.id}|${coupon.code ?? ''}|${coupon.discountLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(coupon);
  }

  return result;
}

export function finalizeParsedCoupons(coupons: MlCoupon[], html?: string): MlCoupon[] {
  const deduped = dedupeCoupons(coupons);
  if (!html?.trim()) return deduped;
  return enrichCouponsWithDomHints(enrichStoreUrls(deduped, html), html);
}

export function parseCouponsHtml(html: string): MlCoupon[] {
  const affiliateCoupons = extractAffiliateCouponsFromHtml(html);
  if (affiliateCoupons.length > 0) {
    return affiliateCoupons;
  }

  const coupons: MlCoupon[] = [];

  for (const blob of extractJsonBlobs(html)) {
    try {
      collectCouponsFromUnknown(JSON.parse(blob), coupons);
    } catch {
      // JSON parcial — ignorar
    }
  }

  try {
    collectCouponsFromUnknown(JSON.parse(html), coupons);
  } catch {
    // não é JSON puro
  }

  coupons.push(...parseDomCoupons(html));

  return enrichCouponsWithDomHints(enrichStoreUrls(dedupeCoupons(coupons), html), html);
}

export function parseCouponsJson(data: unknown, html?: string): MlCoupon[] {
  const coupons: MlCoupon[] = [];
  collectCouponsFromUnknown(data, coupons);
  return finalizeParsedCoupons(coupons, html);
}

export function isLoginHtml(html: string): boolean {
  if (/Digite seu e-mail ou telefone para iniciar sessão/i.test(html)) return true;
  if (/jms\/mlb\/lgz|account-verification|registration\/enrollment/i.test(html)) return true;
  return /<title>[^<]*(Entrar|Login|Iniciar sess[aã]o)/i.test(html);
}
