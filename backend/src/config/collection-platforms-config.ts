import { getAccountsCachedSync } from '../accounts/repository.js';
import { DEFAULT_ACCOUNT_ID } from '../accounts/types.js';
import { prisma } from '../database/client.js';

const AMAZON_COLLECTION_ENABLED_KEY = 'amazonCollectionEnabled';

let amazonCollectionEnabledCache: boolean | null = null;

export function invalidateCollectionPlatformsCache(): void {
  amazonCollectionEnabledCache = null;
}

export async function hydrateCollectionPlatformsCache(): Promise<void> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: AMAZON_COLLECTION_ENABLED_KEY } });
    amazonCollectionEnabledCache = row?.value !== 'false';
  } catch {
    amazonCollectionEnabledCache = true;
  }
}

export function isAmazonCollectionEnabled(): boolean {
  return amazonCollectionEnabledCache ?? true;
}

export async function saveAmazonCollectionEnabled(enabled: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: AMAZON_COLLECTION_ENABLED_KEY },
    create: { key: AMAZON_COLLECTION_ENABLED_KEY, value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' },
  });
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
