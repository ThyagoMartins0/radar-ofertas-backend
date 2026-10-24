import type { Channel } from '../channels/types.js';
import { isMercadoLivreAffiliateTagConfigured } from '../accounts/ml-affiliate-tag.js';
import {
  getActiveAmazonSourcesForChannel,
  getChannelsForAmazonSource,
  hydrateAmazonSourcesCache,
} from '../config/amazon-sources-config.js';
import { isAmazonCollectionEnabled, isMercadoLivreCollectionEnabled } from '../config/collection-platforms-config.js';
import {
  getActiveMlCategoriesForChannel,
  getChannelsForCategory,
  hydrateMlSourcesCache,
} from '../config/ml-sources-config.js';
import { isAmazonSourceUrl } from '../amazon/source-url.js';
import { iterateAmazonScrapedPages } from '../amazon/index.js';
import { iterateScrapedPages } from '../mercado-livre/index.js';
import type { RawOffer } from '../offers/types.js';
import { logger } from '../utils/logger.js';

const ML_TAG_SKIP_LOG =
  'Coleta ML ignorada — configure a tag de afiliado em Contas → Mercado Livre → Configurar';

export async function hydrateAllSourcesCaches(): Promise<void> {
  const { hydrateCollectionPlatformsCache } = await import('../config/collection-platforms-config.js');
  await Promise.all([hydrateMlSourcesCache(), hydrateAmazonSourcesCache(), hydrateCollectionPlatformsCache()]);
}

export function getActiveSourcesForChannel(channel: Channel): string[] {
  const ml = isMercadoLivreCollectionEnabled() ? getActiveMlCategoriesForChannel(channel) : [];
  const amazon = isAmazonCollectionEnabled() ? getActiveAmazonSourcesForChannel(channel) : [];
  return [...ml, ...amazon];
}

export function getChannelsForSource(source: string): Channel[] {
  if (isAmazonSourceUrl(source)) {
    return getChannelsForAmazonSource(source);
  }
  return getChannelsForCategory(source);
}

export async function* iterateSourcePages(source: string): AsyncGenerator<RawOffer[]> {
  if (isAmazonSourceUrl(source)) {
    yield* iterateAmazonScrapedPages(source);
    return;
  }

  if (!(await isMercadoLivreAffiliateTagConfigured())) {
    logger.warn({ source }, ML_TAG_SKIP_LOG);
    return;
  }

  yield* iterateScrapedPages(source);
}
