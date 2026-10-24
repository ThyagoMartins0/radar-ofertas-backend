export type CategoryConfigType = 'id' | 'url';
export type CategoryListingKind = 'category' | 'offers';

export interface CategoryValidation {
  category: string;
  valid: boolean;
  type: CategoryConfigType;
  listingKind: CategoryListingKind;
  url: string;
  reason?: string;
}

const OFFERS_PATH_PATTERN = /\/ofertas(?:\/|$)/;

export function isOffersListingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'www.mercadolivre.com.br' && OFFERS_PATH_PATTERN.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function buildCategoryListingUrl(category: string): string {
  if (category.startsWith('http://') || category.startsWith('https://')) {
    return category;
  }
  return `https://lista.mercadolivre.com.br/_CategoryId_${category}`;
}

export function validateCategoryConfig(category: string): CategoryValidation {
  const trimmed = category.trim();
  if (!trimmed) {
    return {
      category: trimmed,
      valid: false,
      type: 'id',
      listingKind: 'category',
      url: '',
      reason: 'empty category',
    };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const isListingHost =
        parsed.hostname.includes('lista.mercadolivre.com.br') ||
        parsed.hostname === 'www.mercadolivre.com.br';
      const listingKind: CategoryListingKind = isOffersListingUrl(trimmed) ? 'offers' : 'category';
      return {
        category: trimmed,
        valid: isListingHost,
        type: 'url',
        listingKind,
        url: listingKind === 'offers' ? normalizeOffersListingUrl(trimmed) : trimmed,
        reason: isListingHost
          ? undefined
          : 'URL must use lista.mercadolivre.com.br or www.mercadolivre.com.br',
      };
    } catch {
      return {
        category: trimmed,
        valid: false,
        type: 'url',
        listingKind: 'category',
        url: trimmed,
        reason: 'invalid URL',
      };
    }
  }

  const isCategoryId = /^ML[A-Z]\d+$/i.test(trimmed);
  const url = buildCategoryListingUrl(trimmed);
  return {
    category: trimmed,
    valid: isCategoryId,
    type: 'id',
    listingKind: 'category',
    url,
    reason: isCategoryId ? undefined : 'category ID must match MLB1234 pattern',
  };
}

export function normalizeOffersListingUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('page');
  parsed.hash = '';
  return parsed.toString();
}

export function buildOffersPaginatedUrl(baseUrl: string, page: number): string {
  const parsed = new URL(normalizeOffersListingUrl(baseUrl));
  if (page > 0) {
    parsed.searchParams.set('page', String(page));
  }
  return parsed.toString();
}

export function buildPaginatedListingUrl(url: string, offset: number): string {
  if (offset <= 0) return url;

  const desde = `_Desde_${offset}`;

  if (url.includes('_CategoryId_')) {
    return url.replace('/_CategoryId_', `/${desde}_CategoryId_`);
  }

  const parsed = new URL(url);
  const basePath = parsed.pathname.replace(/\/$/, '');
  parsed.pathname = `${basePath}/${desde}`;
  return parsed.toString();
}

export const ML_ITEMS_PER_PAGE = 48;
export const ML_OFFERS_ITEMS_PER_PAGE = 35;

export function listingOffsetsForLimit(limit: number): number[] {
  const pages = Math.ceil(limit / ML_ITEMS_PER_PAGE);
  const offsets: number[] = [0];

  for (let page = 1; page < pages; page++) {
    offsets.push(page * ML_ITEMS_PER_PAGE + 1);
  }

  return offsets;
}

export function maxOffersPagesForLimit(limit: number): number {
  return Math.max(3, Math.ceil(limit / 20) + 4);
}
