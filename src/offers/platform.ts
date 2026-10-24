import { isAmazonAsin, isAmazonProductUrl } from '../amazon/url.js';
import type { OfferRecord } from './types.js';

export type OfferPlatform = 'mercado_livre' | 'amazon' | 'unknown';

function looksLikeMercadoLivreId(productId: string): boolean {
  return /^MLB-?\d+/i.test(productId.trim());
}

export function detectOfferPlatform(
  offer: Pick<OfferRecord, 'mercadoLivreId' | 'permalink'>,
): OfferPlatform {
  const permalink = offer.permalink?.trim() ?? '';
  if (permalink) {
    if (isAmazonProductUrl(permalink) || /(^|\.)amazon\./i.test(permalink)) {
      return 'amazon';
    }
    if (/mercadolivre|mercadolibre/i.test(permalink)) {
      return 'mercado_livre';
    }
  }

  const productId = offer.mercadoLivreId.trim();
  if (looksLikeMercadoLivreId(productId)) return 'mercado_livre';
  if (isAmazonAsin(productId)) return 'amazon';

  return 'unknown';
}

export function offerPlatformLabel(platform: OfferPlatform): string {
  if (platform === 'mercado_livre') return 'Mercado Livre';
  if (platform === 'amazon') return 'Amazon';
  return 'Desconhecida';
}

export function offerPlatformShortLabel(platform: OfferPlatform): string {
  if (platform === 'mercado_livre') return 'ML';
  if (platform === 'amazon') return 'Amazon';
  return '?';
}

export function offerProductIdLabel(platform: OfferPlatform): string {
  if (platform === 'amazon') return 'ASIN';
  if (platform === 'mercado_livre') return 'ML ID';
  return 'ID do produto';
}
