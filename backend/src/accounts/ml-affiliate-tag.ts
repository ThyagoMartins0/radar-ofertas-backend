import { env } from '../config/env.js';
import type { MercadoLivreAccountConfig } from './types.js';
import { DEFAULT_ACCOUNT_ID } from './types.js';
import { findAccount } from './repository.js';

export function resolveMercadoLivreAffiliateTagFromConfig(
  config: MercadoLivreAccountConfig | undefined,
): string {
  const tag = config?.affiliateTag?.trim();
  return tag || env.AFFILIATE_CONFIG.tag;
}

export async function resolveMercadoLivreAffiliateTag(
  accountId = DEFAULT_ACCOUNT_ID,
): Promise<string> {
  const account = await findAccount(accountId, 'mercado_livre');
  if (account?.platform !== 'mercado_livre') {
    return env.AFFILIATE_CONFIG.tag;
  }
  return resolveMercadoLivreAffiliateTagFromConfig(account.config);
}

export async function isMercadoLivreAffiliateTagConfigured(
  accountId = DEFAULT_ACCOUNT_ID,
): Promise<boolean> {
  const tag = await resolveMercadoLivreAffiliateTag(accountId);
  return Boolean(tag.trim());
}
