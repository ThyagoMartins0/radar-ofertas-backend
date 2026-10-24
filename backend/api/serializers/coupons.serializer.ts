import type { CouponsPageData } from '../../manager/models/coupons-model.js';

export function serializeCoupons(data: CouponsPageData) {
  return {
    coupons: data.coupons,
    couponsUrl: data.couponsUrl,
    scrapedAt: data.scrapedAt,
    source: data.source,
  };
}
