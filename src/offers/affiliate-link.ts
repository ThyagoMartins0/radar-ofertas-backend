import { buildAmazonAffiliateLink } from '../amazon/affiliate-link.js';
import { isAmazonAsin, isAmazonProductUrl } from '../amazon/url.js';
import { getAmazonConfigFromDb } from '../config/amazon-config-store.js';
import { buildAffiliateLink as buildMlAffiliateLink } from '../mercado-livre/index.js';

export interface OfferAffiliateLinkOptions {
  allowBrowser?: boolean;
  timeoutMs?: number;
}

export async function buildOfferAffiliateLink(
  permalink: string,
  productId: string,
  minDelayMs?: number,
  options?: OfferAffiliateLinkOptions,
): Promise<string> {
  if (isAmazonProductUrl(permalink) || isAmazonAsin(productId)) {
    const config = await getAmazonConfigFromDb();
    return buildAmazonAffiliateLink(permalink || productId, config).url;
  }

  return buildMlAffiliateLink(permalink, productId, minDelayMs, options);
}

/** Ofertas Amazon com link inválido (link.amazon ou sem tag) devem ser regeneradas no envio. */
export function shouldRefreshAmazonAffiliateLink(
  permalink: string,
  productId: string,
  affiliateLink: string | null,
): boolean {
  if (!affiliateLink) return false;
  if (!isAmazonProductUrl(permalink) && !isAmazonAsin(productId)) return false;
  if (/^https?:\/\/link\.amazon\//i.test(affiliateLink)) return true;
  if (/amazon\./i.test(affiliateLink) && !/[?&]tag=/i.test(affiliateLink)) return true;
  return false;
}
