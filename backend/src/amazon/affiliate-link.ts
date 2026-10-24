import type { AmazonAffiliateConfig } from './types.js';
import { extractAmazonAsin } from './url.js';

export interface AmazonAffiliateLinkResult {
  asin: string;
  url: string;
  source: 'store_tag' | 'prefix' | 'passthrough';
}

function normalizeAffiliatePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return 'https://www.amazon.com.br/';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function buildStoreTagUrl(
  asin: string,
  config: Pick<AmazonAffiliateConfig, 'baseUrl' | 'storeId'>,
): string {
  const base = normalizeBaseUrl(config.baseUrl);
  const url = new URL(`dp/${asin}`, base);
  url.searchParams.set('tag', config.storeId.trim());
  return url.toString();
}

function isInvalidAmazonShortPrefix(prefix: string): boolean {
  return /^https?:\/\/link\.amazon\/?$/i.test(prefix.replace(/\/$/, ''));
}

/** Monta o link de afiliado a partir do ASIN ou URL de produto. */
export function buildAmazonAffiliateLink(
  input: string,
  config: Pick<AmazonAffiliateConfig, 'affiliateLinkPrefix' | 'baseUrl' | 'storeId'>,
): AmazonAffiliateLinkResult {
  const asin = extractAmazonAsin(input);
  if (!asin) {
    throw new Error('Não foi possível extrair o ASIN da URL ou código informado');
  }

  if (config.storeId.trim()) {
    return {
      asin,
      url: buildStoreTagUrl(asin, config),
      source: 'store_tag',
    };
  }

  const prefix = normalizeAffiliatePrefix(config.affiliateLinkPrefix);
  if (prefix && !isInvalidAmazonShortPrefix(prefix)) {
    return { asin, url: `${prefix}${asin}`, source: 'prefix' };
  }

  throw new Error('ID da loja Amazon (tag de afiliado) não configurado');
}

/** Links link.amazon/{ASIN} não são válidos — sempre reconstrói com a tag da loja. */
export function resolveAmazonAffiliateLink(
  input: string,
  config: AmazonAffiliateConfig,
): AmazonAffiliateLinkResult {
  const trimmed = input.trim();
  if (/amazon\./i.test(trimmed) && /[?&]tag=/i.test(trimmed)) {
    const asin = extractAmazonAsin(trimmed);
    if (asin) {
      return { asin, url: trimmed, source: 'passthrough' };
    }
  }

  return buildAmazonAffiliateLink(trimmed, config);
}
