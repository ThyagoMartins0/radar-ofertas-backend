import type { Channel } from '../channels/types.js';

export interface RawOffer {
  mercadoLivreId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  image: string | null;
  rating: number | null;
  soldQuantity: number | null;
  salesRank: string | null;
  seller: string | null;
  officialStore: boolean;
  bestSeller: boolean;
  permalink: string;
  /**
   * Fonte (categoria/URL ML) de onde a oferta foi coletada. Usado no dispatch
   * para rotear a oferta só para os canais que aquela fonte alimenta. Opcional:
   * caminhos que não passam pelo pool por fonte (ex.: e2e) deixam indefinido e
   * caem no fan-out para todos os canais ligados.
   */
  sourceCategory?: string;
}

export interface ScoredOffer extends RawOffer {
  score: number;
  affiliateLink: string;
}

export interface OfferRecord {
  id: string;
  mercadoLivreId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  image: string | null;
  permalink: string | null;
  affiliateLink: string | null;
  rating: number | null;
  soldQuantity: number | null;
  salesRank: string | null;
  seller: string | null;
  officialStore: boolean;
  bestSeller: boolean;
  score: number;
  sentAt: Date | null;
  createdAt: Date;
}

/** Estado do envio de uma oferta para um canal. sentAt nulo = ainda pendente. */
export interface DeliveryRecord {
  id: string;
  offerId: string;
  channel: Channel;
  accountId: string;
  sentAt: Date | null;
  messageId: string | null;
  error: string | null;
  createdAt: Date;
}

export interface CreateOfferInput {
  mercadoLivreId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  image: string | null;
  permalink: string | null;
  affiliateLink: string | null;
  rating: number | null;
  soldQuantity: number | null;
  salesRank: string | null;
  seller: string | null;
  officialStore: boolean;
  bestSeller: boolean;
  score: number;
}
