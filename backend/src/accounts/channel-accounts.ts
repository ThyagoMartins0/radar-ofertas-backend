import type { Channel } from '../channels/types.js';
import { loadAccounts } from './repository.js';
import { DEFAULT_ACCOUNT_ID, type Account, type TelegramAccount } from './types.js';

/** Contas habilitadas para um canal de envio; fallback `default` se nenhuma cadastrada. */
export async function getEnabledAccountIdsForChannel(channel: Channel): Promise<string[]> {
  const accounts = await loadAccounts();
  const enabled = accounts.filter((account) => account.platform === channel && account.enabled);
  if (enabled.length === 0) return [DEFAULT_ACCOUNT_ID];
  return enabled.map((account) => account.id);
}

/**
 * Contas que o worker unificado deve carregar.
 * WhatsApp inclui a conta default mesmo desabilitada — necessário para pareamento/QR
 * antes de configurar destinos no painel.
 */
export function resolveWorkerAccountIds(channel: Channel, accounts: readonly Account[]): string[] {
  const forPlatform = accounts.filter((account) => account.platform === channel);

  if (channel === 'whatsapp') {
    const enabledIds = forPlatform.filter((account) => account.enabled).map((account) => account.id);
    if (enabledIds.length > 0) return enabledIds;

    const hasDefault = forPlatform.some((account) => account.id === DEFAULT_ACCOUNT_ID);
    return hasDefault ? [DEFAULT_ACCOUNT_ID] : [DEFAULT_ACCOUNT_ID];
  }

  if (channel === 'telegram') {
    return forPlatform
      .filter((account): account is TelegramAccount => {
        if (account.platform !== 'telegram' || !account.enabled) return false;
        return Boolean(account.config.botToken.trim() && account.config.chatId.trim());
      })
      .map((account) => account.id);
  }

  return [];
}

export async function getWorkerAccountIdsForChannel(channel: Channel): Promise<string[]> {
  const accounts = await loadAccounts();
  return resolveWorkerAccountIds(channel, accounts);
}
