import { getAccountsCachedSync } from '../accounts/repository.js';
import { DEFAULT_ACCOUNT_ID } from '../accounts/types.js';
import { findSetting, upsertSetting } from '../database/settings.js';

const AMAZON_COLLECTION_ENABLED_KEY = 'amazonCollectionEnabled';

let amazonCollectionEnabledCache: boolean | null = null;

export function invalidateCollectionPlatformsCache(): void {
  amazonCollectionEnabledCache = null;
}

export async function hydrateCollectionPlatformsCache(): Promise<void> {
  try {
    const row = await findSetting(AMAZON_COLLECTION_ENABLED_KEY);
    amazonCollectionEnabledCache = row?.value !== 'false';
  } catch {
    amazonCollectionEnabledCache = true;
  }
}

export function isAmazonCollectionEnabled(): boolean {
  return amazonCollectionEnabledCache ?? true;
}

export async function saveAmazonCollectionEnabled(enabled: boolean): Promise<void> {
  await upsertSetting(AMAZON_COLLECTION_ENABLED_KEY, enabled ? 'true' : 'false');
  amazonCollectionEnabledCache = enabled;
}

export function isMercadoLivreCollectionEnabled(): boolean {
  const accounts = getAccountsCachedSync();
  const mlAccounts = accounts.filter((account) => account.platform === 'mercado_livre');
  if (mlAccounts.length === 0) return true;

  const defaultAccount = mlAccounts.find((account) => account.id === DEFAULT_ACCOUNT_ID);
  if (defaultAccount) return defaultAccount.enabled;

  return mlAccounts.some((account) => account.enabled);
}
