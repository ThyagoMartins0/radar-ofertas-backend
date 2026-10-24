import {
  getCouponsUrlCached,
  getCouponsUrlFromDb,
  hydrateCouponsConfigCache,
} from '../../src/config/coupons-config-store.js';
import { prisma } from '../../src/database/client.js';
import { sendCouponToChannelsNow } from '../../src/offers/coupon-service.js';
import { scrapeAffiliateCoupons } from '../../src/mercado-livre/coupons.js';
import type { CouponScrapeResult, MlCoupon } from '../../src/mercado-livre/types.js';

export interface CouponsPageData {
  coupons: MlCoupon[];
  couponsUrl: string;
  scrapedAt: string | null;
  source: CouponScrapeResult['source'] | null;
  refreshed: boolean;
  error: string | null;
  sendMessage: string | null;
}

const COUPONS_CACHE_KEY = 'couponsLastScrape';
const STORE_LINK_OVERRIDES_KEY = 'couponStoreLinkOverrides';

let lastScrape: CouponScrapeResult | null = null;
let cacheHydrated = false;
let storeLinkOverridesCache: Record<string, string> | null = null;

function couponLookupKey(couponId: string, code?: string | null): string {
  return `${couponId}|${code ?? ''}`;
}

function matchesCoupon(coupon: MlCoupon, couponId: string, code?: string | null): boolean {
  if (coupon.id !== couponId) return false;
  if (code) return coupon.code === code;
  return true;
}

function applyStoreLinkOverrides(
  coupons: MlCoupon[],
  overrides: Record<string, string>,
): MlCoupon[] {
  return coupons.map((coupon) => {
    const override =
      overrides[couponLookupKey(coupon.id, coupon.code)] ??
      overrides[couponLookupKey(coupon.id, null)];
    if (!override?.trim()) return coupon;
    return { ...coupon, storeUrl: override.trim() };
  });
}

async function loadStoreLinkOverrides(): Promise<Record<string, string>> {
  if (storeLinkOverridesCache) return storeLinkOverridesCache;

  try {
    const row = await prisma.setting.findUnique({ where: { key: STORE_LINK_OVERRIDES_KEY } });
    if (row?.value?.trim()) {
      const parsed = JSON.parse(row.value) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        storeLinkOverridesCache = parsed;
        return parsed;
      }
    }
  } catch {
    /* cache inválido — ignora */
  }

  storeLinkOverridesCache = {};
  return storeLinkOverridesCache;
}

async function saveStoreLinkOverrides(overrides: Record<string, string>): Promise<void> {
  await prisma.setting.upsert({
    where: { key: STORE_LINK_OVERRIDES_KEY },
    update: { value: JSON.stringify(overrides) },
    create: { key: STORE_LINK_OVERRIDES_KEY, value: JSON.stringify(overrides) },
  });
  storeLinkOverridesCache = overrides;
}

function visibleCoupons(coupons: MlCoupon[]): MlCoupon[] {
  return coupons.filter((coupon) => coupon.status !== 'generated');
}

async function hydrateCouponsCache(): Promise<void> {
  if (cacheHydrated) return;
  cacheHydrated = true;

  try {
    const row = await prisma.setting.findUnique({ where: { key: COUPONS_CACHE_KEY } });
    if (!row?.value?.trim()) return;

    const parsed = JSON.parse(row.value) as CouponScrapeResult;
    if (Array.isArray(parsed.coupons) && typeof parsed.scrapedAt === 'string') {
      const overrides = await loadStoreLinkOverrides();
      lastScrape = {
        ...parsed,
        coupons: applyStoreLinkOverrides(parsed.coupons, overrides),
      };
    }
  } catch {
    /* cache inválido — ignora */
  }
}

async function persistCouponsCache(result: CouponScrapeResult): Promise<void> {
  await prisma.setting.upsert({
    where: { key: COUPONS_CACHE_KEY },
    update: { value: JSON.stringify(result) },
    create: { key: COUPONS_CACHE_KEY, value: JSON.stringify(result) },
  });
}

export async function loadCouponsPage(
  refreshed = false,
  error: string | null = null,
  sendMessage: string | null = null,
): Promise<CouponsPageData> {
  await hydrateCouponsConfigCache();
  await hydrateCouponsCache();

  if (!lastScrape) {
    const result = await refreshCoupons();
    if (!result.ok && !error) error = result.error;
  }

  const couponsUrl = await getCouponsUrlFromDb();

  return {
    coupons: visibleCoupons(lastScrape?.coupons ?? []),
    couponsUrl,
    scrapedAt: lastScrape?.scrapedAt ?? null,
    source: lastScrape?.source ?? null,
    refreshed,
    error,
    sendMessage,
  };
}

export async function refreshCoupons(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    await hydrateCouponsConfigCache();
    const result = await scrapeAffiliateCoupons();
    const overrides = await loadStoreLinkOverrides();
    lastScrape = {
      ...result,
      coupons: applyStoreLinkOverrides(result.coupons, overrides),
    };
    await persistCouponsCache(lastScrape);
    return { ok: true, count: result.coupons.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao buscar cupons';
    return { ok: false, error: message };
  }
}

export function getCouponsJson(): string {
  return JSON.stringify({
    coupons: visibleCoupons(lastScrape?.coupons ?? []),
    scrapedAt: lastScrape?.scrapedAt ?? null,
    source: lastScrape?.source ?? null,
    couponsUrl: getCouponsUrlCached(),
  });
}

function findCouponForSend(couponId: string, code?: string | null): MlCoupon | undefined {
  const pool = lastScrape?.coupons ?? [];
  if (code) {
    const byCode = pool.find((entry) => entry.code === code);
    if (byCode) return byCode;
  }

  const matches = pool.filter((entry) => entry.id === couponId);
  if (matches.length === 0) return undefined;

  return (
    matches.find((entry) => entry.status === 'available') ??
    matches.sort((a, b) => {
      const priority = (coupon: MlCoupon): number => {
        if (coupon.status === 'available') return 4;
        if (coupon.status === 'unknown') return 3;
        if (coupon.status === 'expired') return 2;
        return 1;
      };
      return priority(b) - priority(a);
    })[0]
  );
}

export async function sendCouponToChannels(
  couponId: string,
  code?: string | null,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  let coupon = findCouponForSend(couponId, code);
  if (!coupon) {
    const refreshed = await refreshCoupons();
    if (!refreshed.ok) {
      return { ok: false, error: 'Cupom não encontrado — atualize a lista e tente novamente.' };
    }
    coupon = findCouponForSend(couponId, code);
  }

  if (!coupon) {
    return { ok: false, error: 'Cupom não encontrado — atualize a lista e tente novamente.' };
  }
  if (coupon.status !== 'available') {
    return { ok: false, error: 'Só é possível enviar cupons com status Disponível.' };
  }

  try {
    const message = await sendCouponToChannelsNow(coupon);
    return { ok: true, message };
  } catch (error) {
    const err = error instanceof Error ? error.message : 'Falha ao enviar cupom';
    return { ok: false, error: err };
  }
}

export async function updateCouponStoreLink(
  couponId: string,
  storeUrl: string,
  code?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await hydrateCouponsCache();

  const trimmed = storeUrl.trim();
  const key = couponLookupKey(couponId, code);
  const overrides = await loadStoreLinkOverrides();

  if (trimmed) overrides[key] = trimmed;
  else delete overrides[key];

  await saveStoreLinkOverrides(overrides);

  if (lastScrape) {
    lastScrape = {
      ...lastScrape,
      coupons: lastScrape.coupons.map((coupon) =>
        matchesCoupon(coupon, couponId, code) ? { ...coupon, storeUrl: trimmed || null } : coupon,
      ),
    };
    await persistCouponsCache(lastScrape);
  }

  return { ok: true };
}
