import { loadAccounts, saveAccounts, resolveAccountAuthPath } from '../../src/accounts/repository.js';
import {
  resolveMercadoLivreAffiliateTagFromConfig,
} from '../../src/accounts/ml-affiliate-tag.js';
import {
  ACCOUNT_PLATFORMS,
  DEFAULT_ACCOUNT_ID,
  accountPlatformLabel,
  isAccountPlatform,
} from '../../src/accounts/types.js';
import type { Account, AccountPlatform } from '../../src/accounts/types.js';
import { env } from '../../src/config/env.js';
import { getWhatsAppConnectFromRedis } from '../../src/utils/redis-state.js';
import { isPlaceholderChannelId } from '../../src/whatsapp/index.js';
import {
  resolveWhatsAppChannelInviteLink,
  resolveWhatsAppChannelName,
} from '../../src/whatsapp/channel-cache.js';
import {
  getMercadoLivreSessionStatusForAuthPath,
  getTelegramSessionStatusForAccount,
  getWhatsAppSessionStatusForAuthPath,
} from './session-model.js';
import { canManagerSpawnWorkers } from './process-model.js';
import { resolveNovncPort } from '../../src/config/novnc.js';
import { loadTelegramAccountView, saveTelegramAccountConfig } from './integration-model.js';
import type { SaveResult } from './shared/save-result.js';
import {
  addWhatsAppDestination,
  loadWhatsAppDestinationViews,
  removeWhatsAppDestinationById,
  savePrimaryWhatsAppChannelFromInvite,
  setWhatsAppDestinationEnabled,
  type WhatsAppDestinationView,
} from './whatsapp-destinations-model.js';

const INTEGRATION_PLATFORMS = ['whatsapp', 'telegram'] as const satisfies readonly AccountPlatform[];
const MARKETPLACE_PLATFORMS = ['mercado_livre'] as const satisfies readonly AccountPlatform[];

export interface WhatsAppAccountMeta {
  destinations: WhatsAppDestinationView[];
  channelId: string;
  channelName: string | null;
  channelInviteLink: string;
  channelConfigured: boolean;
}

export interface TelegramAccountMeta {
  chatId: string;
  hasBotToken: boolean;
}

export interface AccountConnectionMeta {
  loggedIn: boolean;
  detail: string;
}

export interface MercadoLivreAccountMeta {
  sessionOk: boolean;
  sessionDetail: string;
  affiliateTag: string;
  affiliateTagFromEnv: boolean;
}

export interface AccountCardData {
  account: Account;
  whatsapp?: WhatsAppAccountMeta;
  telegram?: TelegramAccountMeta;
  mercadoLivre?: MercadoLivreAccountMeta;
  connection?: AccountConnectionMeta;
}

export interface AccountsPageData {
  integrations: AccountCardData[];
  marketplaces: AccountCardData[];
  integrationPlatforms: { id: AccountPlatform; label: string }[];
  marketplacePlatforms: { id: AccountPlatform; label: string }[];
  canSpawnWorkers: boolean;
  novncPort: number | null;
  saved: string | null;
  error: string | null;
  openConfigAccountId: string | null;
  openConfigPlatform: AccountPlatform | null;
}

async function buildWhatsAppMeta(account: Extract<Account, { platform: 'whatsapp' }>): Promise<WhatsAppAccountMeta> {
  const destinations = await loadWhatsAppDestinationViews(account.id);
  const primaryDestination = destinations.find((destination) => destination.enabled);
  const channelId = primaryDestination?.jid ?? account.config.channelId ?? env.WHATSAPP_CHANNEL_ID;
  let channelName: string | null = primaryDestination?.label ?? account.config.channelName ?? null;
  let channelInviteLink = primaryDestination?.inviteLink ?? account.config.inviteLink ?? '';

  if (channelId && !isPlaceholderChannelId(channelId)) {
    channelName ??= await resolveWhatsAppChannelName(channelId);
    if (!channelInviteLink) {
      channelInviteLink = (await resolveWhatsAppChannelInviteLink(channelId)) ?? '';
    }
  }

  return {
    destinations,
    channelId,
    channelName,
    channelInviteLink,
    channelConfigured:
      Boolean(channelId.trim()) &&
      !isPlaceholderChannelId(channelId) &&
      channelId.endsWith('@newsletter'),
  };
}

/** Integração com credenciais/canal mínimos preenchidos. */
export function isIntegrationConfigured(card: AccountCardData): boolean {
  const { account } = card;

  if (account.platform === 'whatsapp' && card.whatsapp) {
    return card.whatsapp.channelConfigured;
  }

  if (account.platform === 'telegram' && card.telegram) {
    return Boolean(card.telegram.chatId.trim() && card.telegram.hasBotToken);
  }

  return true;
}

/** Status exibido na listagem — exige configuração, login e conta habilitada. */
export function resolveIntegrationDisplayStatus(
  card: AccountCardData,
): 'active' | 'inactive' {
  if (!isIntegrationConfigured(card)) {
    return 'inactive';
  }

  if (!card.connection?.loggedIn) {
    return 'inactive';
  }

  return card.account.enabled ? 'active' : 'inactive';
}

async function reconcileIntegrationEnabledStates(cards: AccountCardData[]): Promise<void> {
  const toDisable = cards.filter(
    (card) =>
      (card.account.platform === 'whatsapp' || card.account.platform === 'telegram') &&
      card.account.enabled &&
      !isIntegrationConfigured(card),
  );

  if (toDisable.length === 0) {
    return;
  }

  const accounts = await loadAccounts();
  for (const card of toDisable) {
    const account = accounts.find(
      (row) => row.id === card.account.id && row.platform === card.account.platform,
    );
    if (account) {
      account.enabled = false;
      card.account.enabled = false;
    }
  }

  await saveAccounts(accounts);
}

async function buildAccountConnectionMeta(account: Account): Promise<AccountConnectionMeta> {
  if (account.platform === 'whatsapp') {
    const session = await getWhatsAppSessionStatusForAuthPath(account.config.authPath);
    if (session.ok) {
      return { loggedIn: true, detail: session.detail };
    }

    // Fallback: Redis já publicou connected e o volume ainda não refletiu creds.json.
    const redis = await getWhatsAppConnectFromRedis(account.id);
    if (redis?.status === 'connected') {
      return { loggedIn: true, detail: 'Sessão WhatsApp ativa' };
    }

    return { loggedIn: false, detail: session.detail };
  }

  if (account.platform === 'telegram') {
    const session = await getTelegramSessionStatusForAccount(account.id);
    return { loggedIn: session.ok, detail: session.detail };
  }

  if (account.platform === 'mercado_livre') {
    const session = await getMercadoLivreSessionStatusForAuthPath(account.config.authPath);
    return { loggedIn: session.ok, detail: session.detail };
  }

  return { loggedIn: false, detail: '' };
}

async function enrichAccount(account: Account): Promise<AccountCardData> {
  const connection = await buildAccountConnectionMeta(account);

  if (account.platform === 'whatsapp') {
    return { account, whatsapp: await buildWhatsAppMeta(account), connection };
  }
  if (account.platform === 'telegram') {
    const telegram = await loadTelegramAccountView(account.id);
    return { account, telegram, connection };
  }
  if (account.platform === 'mercado_livre') {
    const configuredTag = account.config.affiliateTag?.trim() ?? '';
    const effectiveTag = resolveMercadoLivreAffiliateTagFromConfig(account.config);
    return {
      account,
      mercadoLivre: {
        sessionOk: connection.loggedIn,
        sessionDetail: connection.detail,
        affiliateTag: effectiveTag,
        affiliateTagFromEnv: !configuredTag && Boolean(effectiveTag),
      },
      connection,
    };
  }
  return { account, connection };
}

function platformOptions(platforms: readonly AccountPlatform[]) {
  return platforms.map((p) => ({ id: p, label: accountPlatformLabel(p) }));
}

export async function loadAccountsData(
  saved: string | null = null,
  error: string | null = null,
  openConfigAccountId: string | null = null,
  openConfigPlatform: AccountPlatform | null = null,
): Promise<AccountsPageData> {
  const accounts = await loadAccounts();
  const enriched = await Promise.all(accounts.map(enrichAccount));
  await reconcileIntegrationEnabledStates(enriched);

  return {
    integrations: enriched.filter((row) => INTEGRATION_PLATFORMS.includes(row.account.platform as typeof INTEGRATION_PLATFORMS[number])),
    marketplaces: enriched.filter((row) => MARKETPLACE_PLATFORMS.includes(row.account.platform as typeof MARKETPLACE_PLATFORMS[number])),
    integrationPlatforms: platformOptions(INTEGRATION_PLATFORMS),
    marketplacePlatforms: platformOptions(MARKETPLACE_PLATFORMS),
    canSpawnWorkers: canManagerSpawnWorkers(),
    novncPort: resolveNovncPort(),
    saved,
    error,
    openConfigAccountId,
    openConfigPlatform,
  };
}

export async function addAccount(form: Record<string, string>): Promise<SaveResult> {
  const { platform, label } = form;

  if (!platform || !isAccountPlatform(platform)) {
    return { ok: false, error: 'Plataforma inválida' };
  }
  if (!label?.trim()) {
    return { ok: false, error: 'Nome da conta é obrigatório' };
  }

  const accounts = await loadAccounts();
  const id = `${platform}-${Date.now().toString(36)}`;

  if (platform === 'mercado_livre') {
    const existingMl = accounts.some((account) => account.platform === 'mercado_livre');
    if (existingMl) {
      return { ok: false, error: 'Já existe uma conta Mercado Livre configurada' };
    }
  }

  const newAccount: Account =
    platform === 'whatsapp'
      ? {
          id,
          platform: 'whatsapp',
          label: label.trim(),
          enabled: false,
          config: { channelId: '', authPath: resolveAccountAuthPath(id, 'whatsapp') },
        }
      : platform === 'telegram'
        ? {
            id,
            platform: 'telegram',
            label: label.trim(),
            enabled: false,
            config: { botToken: '', chatId: '' },
          }
        : {
            id,
            platform: 'mercado_livre',
            label: label.trim(),
            enabled: true,
            config: {
              authPath: resolveAccountAuthPath(id, 'mercado_livre'),
              affiliateTag: '',
            },
          };

  accounts.push(newAccount);
  await saveAccounts(accounts);
  return { ok: true };
}

export async function toggleAccount(accountId: string, platform: AccountPlatform): Promise<SaveResult> {
  const accounts = await loadAccounts();
  const account = accounts.find((a) => a.id === accountId && a.platform === platform);

  if (!account) {
    return { ok: false, error: 'Conta não encontrada' };
  }

  const enabling = !account.enabled;

  if (
    enabling &&
    (platform === 'whatsapp' || platform === 'telegram')
  ) {
    const card = await enrichAccount(account);
    if (!isIntegrationConfigured(card)) {
      return {
        ok: false,
        error:
          platform === 'whatsapp'
            ? 'Configure o canal do WhatsApp antes de habilitar'
            : 'Configure token e canal do Telegram antes de habilitar',
      };
    }
    if (!card.connection?.loggedIn) {
      return {
        ok: false,
        error:
          platform === 'whatsapp'
            ? 'Faça login no WhatsApp antes de habilitar'
            : 'Verifique o Telegram (Logar) antes de habilitar',
      };
    }
  }

  if (enabling && platform === 'mercado_livre') {
    const card = await enrichAccount(account);
    if (!card.connection?.loggedIn) {
      return { ok: false, error: 'Faça login no Mercado Livre antes de habilitar' };
    }
  }

  account.enabled = !account.enabled;
  await saveAccounts(accounts);
  return { ok: true };
}

export async function removeAccount(accountId: string, platform: AccountPlatform): Promise<SaveResult> {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return { ok: false, error: 'Não é possível remover a conta padrão' };
  }

  const accounts = await loadAccounts();
  const filtered = accounts.filter((a) => !(a.id === accountId && a.platform === platform));

  if (filtered.length === accounts.length) {
    return { ok: false, error: 'Conta não encontrada' };
  }

  await saveAccounts(filtered);
  return { ok: true };
}

export async function saveAccountWhatsAppChannel(
  accountId: string,
  inviteLink: string,
): Promise<SaveResult> {
  return savePrimaryWhatsAppChannelFromInvite(accountId, inviteLink);
}

export async function saveAccountWhatsAppDestination(
  accountId: string,
  inviteInput: string,
): Promise<SaveResult> {
  return addWhatsAppDestination(accountId, inviteInput);
}

export async function removeAccountWhatsAppDestination(
  accountId: string,
  destinationId: string,
): Promise<SaveResult> {
  return removeWhatsAppDestinationById(accountId, destinationId);
}

export async function toggleAccountWhatsAppDestination(
  accountId: string,
  destinationId: string,
  enabled: boolean,
): Promise<SaveResult> {
  return setWhatsAppDestinationEnabled(accountId, destinationId, enabled);
}

export async function saveAccountTelegramConfig(
  accountId: string,
  form: Record<string, string>,
): Promise<SaveResult> {
  return saveTelegramAccountConfig(accountId, {
    enabled: form.telegramEnabled === '1',
    botToken: form.botToken ?? '',
    chatId: form.chatId ?? '',
  });
}

export async function saveAccountMercadoLivreConfig(
  accountId: string,
  form: Record<string, string>,
): Promise<SaveResult> {
  const accounts = await loadAccounts();
  const account = accounts.find((row) => row.id === accountId && row.platform === 'mercado_livre');

  if (!account || account.platform !== 'mercado_livre') {
    return { ok: false, error: 'Conta Mercado Livre não encontrada' };
  }

  account.config = {
    ...account.config,
    affiliateTag: (form.affiliateTag ?? '').trim(),
  };

  await saveAccounts(accounts);
  return { ok: true };
}

export { ACCOUNT_PLATFORMS };
