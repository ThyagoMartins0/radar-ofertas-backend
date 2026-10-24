export interface ScrapedItem {
  id: string;
  title: string;
  price: number;
  originalPrice: number | null;
  thumbnail: string | null;
  permalink: string;
  soldQuantity: number | null;
  salesRank: string | null;
  rating: number | null;
  seller: string | null;
  officialStore: boolean;
  bestSeller: boolean;
  /** Percentual anunciado pelo ML no card ("41% OFF"), quando existe. */
  discountPercent: number | null;
}

export interface MlCoupon {
  id: string;
  title: string;
  description: string;
  discountLabel: string;
  code: string | null;
  category: string | null;
  minPurchase: string | null;
  expiresAt: string | null;
  storeName: string | null;
  storeUrl: string | null;
  sellerId: string | null;
  status: 'available' | 'generated' | 'expired' | 'unknown';
  rawStatus: string | null;
}

export interface CouponScrapeResult {
  coupons: MlCoupon[];
  source: 'http' | 'browser';
  scrapedAt: string;
  sessionRequired: boolean;
}

export interface AffiliateLinkResult {
  url: string;
  shortUrl: string | null;
  source: 'http' | 'browser' | 'fallback';
}

export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
  origins?: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}
