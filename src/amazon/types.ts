/** Site principal da Amazon Brasil (home / navegação). */
export const DEFAULT_AMAZON_BASE_URL = 'https://www.amazon.com.br/';

/** Página padrão de recomendações / browse node. */
export const DEFAULT_AMAZON_RECOMMENDATIONS_URL =
  'https://www.amazon.com.br/b/node/122326793011';

/** Formato oficial Amazon BR: amazon.com.br/dp/{ASIN}?tag={storeId} */
export const DEFAULT_AMAZON_AFFILIATE_LINK_PREFIX = '';

export interface AmazonAffiliateConfig {
  baseUrl: string;
  /** Prefixo opcional de link curto customizado (link.amazon não é válido). */
  affiliateLinkPrefix: string;
  /** ID da loja / tracking tag — ex.: mercadaodasfa-20 */
  storeId: string;
}

export const EXAMPLE_AMAZON_PRODUCT_URL =
  'https://www.amazon.com.br/Bettdow-SmartWatch-smartwatch-recebimento-notificacoes/dp/B0DNHGQHMY/';

export const EXAMPLE_AMAZON_ASIN = 'B0DNHGQHMY';

export const EXAMPLE_AMAZON_AFFILIATE_URL =
  'https://www.amazon.com.br/dp/B0DNHGQHMY?tag=mercadaodasfa-20';

export interface AmazonScrapedItem {
  asin: string;
  title: string;
  price: number;
  originalPrice: number | null;
  thumbnail: string | null;
  permalink: string;
  rating: number | null;
  /** Quantidade de avaliações — persistida em Offer.salesRank para ofertas Amazon. */
  reviewsCount: number | null;
  soldQuantity: number | null;
  seller: string | null;
  /** Texto promocional/cupom exibido na PDP (não persistido no banco). */
  coupon: string | null;
  bestSeller: boolean;
}
