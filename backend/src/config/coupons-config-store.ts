import { env } from './env.js';
import { prisma } from '../database/client.js';

const SETTING_KEY = 'mlCouponsUrl';

let cache: string | null = null;

export function invalidateCouponsConfigCache(): void {
  cache = null;
}

export async function hydrateCouponsConfigCache(): Promise<void> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row?.value?.trim()) {
      cache = row.value.trim();
    }
  } catch {
    // fallback em env
  }
}

export function getCouponsUrlCached(): string {
  return cache ?? env.ML_COUPONS_URL;
}

export async function getCouponsUrlFromDb(): Promise<string> {
  if (cache) return cache;

  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (row?.value?.trim()) {
    cache = row.value.trim();
    return cache;
  }

  return env.ML_COUPONS_URL;
}

export async function saveCouponsUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Informe a URL de cupons do Mercado Livre');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URL inválida');
  }

  if (!/mercadolivre|mercadolibre/i.test(parsed.hostname)) {
    throw new Error('A URL deve ser do Mercado Livre');
  }

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: trimmed },
    create: { key: SETTING_KEY, value: trimmed },
  });

  cache = trimmed;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('coupons-config');
}
