import { findAccount, loadAccounts, saveAccounts } from '../../src/accounts/repository.js';
import { DEFAULT_ACCOUNT_ID } from '../../src/accounts/types.js';
import type { TelegramAccount } from '../../src/accounts/types.js';
import { hydrateIntegrationState } from '../../src/channels/integration-state.js';
import type { SaveResult } from './shared/save-result.js';

async function persistAccountsUpdate(
  updater: (accounts: Awaited<ReturnType<typeof loadAccounts>>) => void,
): Promise<void> {
  const accounts = await loadAccounts();
  updater(accounts);
  await saveAccounts(accounts);
  await hydrateIntegrationState();
}

export async function saveTelegramAccountConfig(
  accountId: string,
  input: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  },
): Promise<SaveResult> {
  const chatId = input.chatId.trim();
  const botToken = input.botToken.trim();

  const existing = await findAccount(accountId, 'telegram');
  if (existing?.platform === 'telegram') {
    const effectiveToken = botToken || existing.config.botToken || '';
    if (input.enabled && (!effectiveToken || !chatId)) {
      return { ok: false, error: 'Para ativar o Telegram, informe token do bot e ID do canal' };
    }
  } else if (input.enabled && (!botToken || !chatId)) {
    return { ok: false, error: 'Para ativar o Telegram, informe token do bot e ID do canal' };
  }

  try {
    await persistAccountsUpdate((accounts) => {
      let account = accounts.find((row) => row.id === accountId && row.platform === 'telegram') as
        TelegramAccount | undefined;

      if (!account) {
        account = {
          id: accountId,
          platform: 'telegram',
          label: accountId === DEFAULT_ACCOUNT_ID ? 'Telegram principal' : 'Telegram',
          enabled: false,
          config: { botToken: '', chatId: '' },
        };
        accounts.push(account);
      }

      account.enabled = input.enabled;
      account.config.chatId = chatId;
      if (botToken) {
        account.config.botToken = botToken;
      }
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function loadTelegramIntegrationView(): Promise<{
  enabled: boolean;
  chatId: string;
  hasBotToken: boolean;
}> {
  const account = await findAccount(DEFAULT_ACCOUNT_ID, 'telegram');
  if (!account || account.platform !== 'telegram') {
    return { enabled: false, chatId: '', hasBotToken: false };
  }
  return {
    enabled: account.enabled,
    chatId: account.config.chatId,
    hasBotToken: Boolean(account.config.botToken),
  };
}

export async function loadTelegramAccountView(accountId: string): Promise<{
  enabled: boolean;
  chatId: string;
  hasBotToken: boolean;
}> {
  const account = await findAccount(accountId, 'telegram');
  if (!account || account.platform !== 'telegram') {
    return { enabled: false, chatId: '', hasBotToken: false };
  }
  return {
    enabled: account.enabled,
    chatId: account.config.chatId,
    hasBotToken: Boolean(account.config.botToken),
  };
}
