import path from 'node:path';
import { env } from '../config/env.js';
import { execute, fromJson, query, toBool, toJson, transaction } from '../database/client.js';
import { isPlaceholderChannelId } from '../whatsapp/index.js';
import { parseAccountRecord, parseAccountRow } from './account-config.js';
import {
  DEFAULT_ACCOUNT_ID,
  type Account,
  type AccountPlatform,
  type MercadoLivreAccount,
  type TelegramAccount,
  type WhatsAppAccount,
} from './types.js';

const DATA_ROOT = './data';

let accountsCache: Account[] | null = null;

export function getAccountsCachedSync(): Account[] {
  return accountsCache ?? buildDefaultAccountsFromEnv();
}

/**
 * Caminho de auth isolado por conta. A conta default reutiliza os paths do .env
 * para não quebrar instalações existentes; contas adicionais ficam em
 * data/accounts/{accountId}/{platform}/.
 */
export function resolveAccountAuthPath(accountId: string, platform: AccountPlatform): string {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    if (platform === 'whatsapp') return env.WHATSAPP_AUTH_PATH;
    if (platform === 'mercado_livre') return env.ML_AUTH_PATH;
    return path.join(DATA_ROOT, 'accounts', accountId, platform);
  }

  return path.join(DATA_ROOT, 'accounts', accountId, platform);
}

export function resolveAccountsDataRoot(): string {
  return path.join(DATA_ROOT, 'accounts');
}

function isWhatsAppChannelConfigured(channelId: string): boolean {
  return (
    Boolean(channelId.trim()) &&
    !isPlaceholderChannelId(channelId) &&
    channelId.endsWith('@newsletter')
  );
}

/** Contas derivadas do .env — compatibilidade com instalação single-account. */
function buildDefaultAccountsFromEnv(): Account[] {
  const accounts: Account[] = [];

  const whatsapp: WhatsAppAccount = {
    id: DEFAULT_ACCOUNT_ID,
    platform: 'whatsapp',
    label: 'WhatsApp principal',
    enabled: isWhatsAppChannelConfigured(env.WHATSAPP_CHANNEL_ID),
    config: {
      channelId: env.WHATSAPP_CHANNEL_ID,
      authPath: resolveAccountAuthPath(DEFAULT_ACCOUNT_ID, 'whatsapp'),
    },
  };
  accounts.push(whatsapp);

  const telegram: TelegramAccount = {
    id: DEFAULT_ACCOUNT_ID,
    platform: 'telegram',
    label: 'Telegram principal',
    enabled: false,
    config: {
      botToken: env.TELEGRAM_BOT_TOKEN.trim(),
      chatId: env.TELEGRAM_CHAT_ID.trim(),
    },
  };
  if (telegram.config.botToken && telegram.config.chatId) {
    telegram.enabled = env.TELEGRAM_ENABLED;
  }
  accounts.push(telegram);

  const mercadoLivre: MercadoLivreAccount = {
    id: DEFAULT_ACCOUNT_ID,
    platform: 'mercado_livre',
    label: 'Afiliado ML principal',
    enabled: true,
    config: {
      authPath: resolveAccountAuthPath(DEFAULT_ACCOUNT_ID, 'mercado_livre'),
      affiliateTag: env.AFFILIATE_CONFIG.tag,
    },
  };
  accounts.push(mercadoLivre);

  return accounts;
}

function accountKey(account: Pick<Account, 'id' | 'platform'>): string {
  return `${account.id}:${account.platform}`;
}

async function persistAccounts(accounts: Account[]): Promise<Account[]> {
  const validated = accounts.map((account) => parseAccountRecord(account));
  const keepKeys = new Set(validated.map(accountKey));

  await transaction(async (conn) => {
    const existing = await query<{ id: string; platform: string }>(
      'SELECT id, platform FROM accounts',
      [],
      conn,
    );
    for (const row of existing) {
      if (!keepKeys.has(`${row.id}:${row.platform}`)) {
        await execute(
          'DELETE FROM accounts WHERE id = ? AND platform = ?',
          [row.id, row.platform],
          conn,
        );
      }
    }

    for (const account of validated) {
      await execute(
        `INSERT INTO accounts (id, platform, label, enabled, config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           label = VALUES(label), enabled = VALUES(enabled), config = VALUES(config)`,
        [
          account.id,
          account.platform,
          account.label,
          account.enabled,
          toJson(account.config),
          new Date(),
        ],
        conn,
      );
    }
  });

  accountsCache = validated;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('accounts');
  return validated;
}

async function seedDefaultAccounts(): Promise<Account[]> {
  return persistAccounts(buildDefaultAccountsFromEnv());
}

/** Garante contas default por plataforma após migrações ou instalações parciais. */
async function ensureDefaultPlatformAccounts(accounts: Account[]): Promise<Account[]> {
  const defaults = buildDefaultAccountsFromEnv();
  const missing = defaults.filter(
    (candidate) =>
      !accounts.some(
        (existing) => existing.id === candidate.id && existing.platform === candidate.platform,
      ),
  );
  if (missing.length === 0) return accounts;
  return persistAccounts([...accounts, ...missing]);
}

export async function loadAccounts(): Promise<Account[]> {
  if (accountsCache) return accountsCache;

  try {
    const rows = await query<{
      id: string;
      platform: string;
      label: string;
      enabled: unknown;
      config: unknown;
    }>('SELECT id, platform, label, enabled, config FROM accounts ORDER BY id ASC, platform ASC');
    if (rows.length === 0) {
      return seedDefaultAccounts();
    }

    const loaded = rows.map((row) =>
      parseAccountRow({ ...row, enabled: toBool(row.enabled), config: fromJson(row.config) }),
    );
    accountsCache = await ensureDefaultPlatformAccounts(loaded);
    return accountsCache;
  } catch {
    accountsCache = buildDefaultAccountsFromEnv();
    return accountsCache;
  }
}

export async function saveAccounts(accounts: Account[]): Promise<void> {
  invalidateAccountsCache();
  await persistAccounts(accounts);
}

export async function findAccount(
  id: string,
  platform: AccountPlatform,
): Promise<Account | null> {
  const accounts = await loadAccounts();
  return (
    accounts.find((account) => account.id === id && account.platform === platform) ?? null
  );
}

/** @deprecated Prefira findAccount(id, platform) quando a plataforma for conhecida. */
export async function findAccountById(
  id: string,
  platform?: AccountPlatform,
): Promise<Account | null> {
  const accounts = await loadAccounts();
  if (platform) {
    return accounts.find((account) => account.id === id && account.platform === platform) ?? null;
  }
  return accounts.find((account) => account.id === id) ?? null;
}

export async function findAccountsByPlatform(platform: AccountPlatform): Promise<Account[]> {
  const accounts = await loadAccounts();
  return accounts.filter((account) => account.platform === platform && account.enabled);
}

export async function getDefaultAccountForPlatform(
  platform: AccountPlatform,
): Promise<Account | null> {
  const accounts = await findAccountsByPlatform(platform);
  return accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID) ?? accounts[0] ?? null;
}

export function invalidateAccountsCache(): void {
  accountsCache = null;
}
