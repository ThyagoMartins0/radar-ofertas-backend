import { z } from 'zod';
import { env } from './env.js';
import { prisma } from '../database/client.js';
import {
  DEFAULT_AMAZON_AFFILIATE_LINK_PREFIX,
  DEFAULT_AMAZON_BASE_URL,
  type AmazonAffiliateConfig,
} from '../amazon/types.js';

const SETTING_KEY = 'amazonAffiliateConfig';

const amazonConfigSchema = z.object({
  baseUrl: z.string().url(),
  affiliateLinkPrefix: z.string().default(''),
  storeId: z.string().min(1),
});

let cache: AmazonAffiliateConfig | null = null;

function defaultsFromEnv(): AmazonAffiliateConfig {
  return {
    baseUrl: env.AMAZON_BASE_URL,
    affiliateLinkPrefix: env.AMAZON_AFFILIATE_LINK_PREFIX,
    storeId: env.AMAZON_AFFILIATE_STORE_ID,
  };
}

export function invalidateAmazonConfigCache(): void {
  cache = null;
}

export async function hydrateAmazonConfigCache(): Promise<void> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row?.value?.trim()) return;
    const parsed = amazonConfigSchema.parse(JSON.parse(row.value));
    cache = parsed;
  } catch {
    // fallback em env
  }
}

export function getAmazonConfigCached(): AmazonAffiliateConfig {
  return cache ?? defaultsFromEnv();
}

export async function getAmazonConfigFromDb(): Promise<AmazonAffiliateConfig> {
  if (cache) return cache;

  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (row?.value?.trim()) {
    try {
      cache = amazonConfigSchema.parse(JSON.parse(row.value));
      return cache;
    } catch {
      // invalid stored config — fall through to env defaults
    }
  }

  return defaultsFromEnv();
}

export async function saveAmazonAffiliateConfig(
  input: AmazonAffiliateConfig,
): Promise<AmazonAffiliateConfig> {
  const config = amazonConfigSchema.parse({
    baseUrl: input.baseUrl.trim(),
    affiliateLinkPrefix: input.affiliateLinkPrefix.trim(),
    storeId: input.storeId?.trim() ?? '',
  });

  if (!/amazon\./i.test(new URL(config.baseUrl).hostname)) {
    throw new Error('A URL base deve ser do domínio Amazon');
  }

  if (!config.storeId.trim()) {
    throw new Error('O ID da loja (tag de afiliado) é obrigatório para links Amazon');
  }

  if (
    config.affiliateLinkPrefix.trim() &&
    /^https?:\/\/link\.amazon\/?$/i.test(config.affiliateLinkPrefix.trim().replace(/\/$/, ''))
  ) {
    throw new Error('link.amazon não é um domínio válido — use o ID da loja (tag) no link amazon.com.br/dp/ASIN?tag=...');
  }

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(config) },
    create: { key: SETTING_KEY, value: JSON.stringify(config) },
  });

  cache = config;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('amazon-config');
  return config;
}

export function getDefaultAmazonAffiliateConfig(): AmazonAffiliateConfig {
  return {
    baseUrl: DEFAULT_AMAZON_BASE_URL,
    affiliateLinkPrefix: DEFAULT_AMAZON_AFFILIATE_LINK_PREFIX,
    storeId: '',
  };
}
