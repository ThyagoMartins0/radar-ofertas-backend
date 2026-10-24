import { findAccount } from '../../src/accounts/repository.js';
import { getTelegramIntegration, isTelegramIntegrationEnabled } from '../../src/channels/integration-state.js';
import { env } from '../../src/config/env.js';
import {
  getMlAuthPath,
  loadSessionMeta,
  loadStorageState,
  hasValidSession,
  setMlAuthPath,
} from '../../src/mercado-livre/session.js';
import { hasWhatsAppCredentials } from '../../src/whatsapp/index.js';
import { formatIsoInTimezone } from '../../src/utils/datetime.js';

export interface SessionStatus {
  label: string;
  ok: boolean;
  detail: string;
}

async function withMlAuthPath<T>(authPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = getMlAuthPath();
  setMlAuthPath(authPath);
  try {
    return await fn();
  } finally {
    setMlAuthPath(previous);
  }
}

async function buildMercadoLivreSessionStatus(): Promise<SessionStatus> {
  const state = await loadStorageState();
  const meta = await loadSessionMeta();
  const valid = hasValidSession(state);

  if (!state) {
    return { label: 'Mercado Livre', ok: false, detail: 'Sem sessão — use Logar em Contas' };
  }

  const detail = valid
    ? meta.lastRefreshAt
      ? `Atualizada em ${formatIsoInTimezone(meta.lastRefreshAt, env.APP_TIMEZONE)}`
      : meta.lastLoginAt
        ? `Login em ${formatIsoInTimezone(meta.lastLoginAt, env.APP_TIMEZONE)}`
        : 'Sessão ativa'
    : meta.lastError
      ? `Erro: ${meta.lastError}`
      : meta.lastLoginAt
        ? `Login em ${formatIsoInTimezone(meta.lastLoginAt, env.APP_TIMEZONE)}`
        : 'Sessão expirada ou inválida';

  return { label: 'Mercado Livre', ok: valid, detail };
}

export async function getMercadoLivreSessionStatus(): Promise<SessionStatus> {
  return buildMercadoLivreSessionStatus();
}

export async function getMercadoLivreSessionStatusForAuthPath(authPath: string): Promise<SessionStatus> {
  return withMlAuthPath(authPath, buildMercadoLivreSessionStatus);
}

export async function getWhatsAppSessionStatus(): Promise<SessionStatus> {
  return getWhatsAppSessionStatusForAuthPath(env.WHATSAPP_AUTH_PATH);
}

export async function getWhatsAppSessionStatusForAuthPath(authPath: string): Promise<SessionStatus> {
  const loggedIn = await hasWhatsAppCredentials(authPath);

  if (!loggedIn) {
    return { label: 'WhatsApp', ok: false, detail: 'Não logado — use Logar em Contas' };
  }

  return { label: 'WhatsApp', ok: true, detail: 'Sessão WhatsApp salva' };
}

export async function getTelegramSessionStatusForAccount(accountId: string): Promise<SessionStatus> {
  const account = await findAccount(accountId, 'telegram');
  if (!account || account.platform !== 'telegram') {
    return { label: 'Telegram', ok: false, detail: 'Conta não encontrada' };
  }

  const { botToken, chatId } = account.config;
  if (!botToken.trim() || !chatId.trim()) {
    return { label: 'Telegram', ok: false, detail: 'Configure token e canal antes de logar' };
  }

  const { getBotIdentity, validateTelegramChat } = await import('../../src/telegram/index.js');

  try {
    const bot = await getBotIdentity(botToken);
    const chat = await validateTelegramChat(chatId, botToken);
    if (!chat.valid) {
      return { label: 'Telegram', ok: false, detail: chat.reason ?? 'Canal inválido' };
    }
    return {
      label: 'Telegram',
      ok: true,
      detail: `Bot @${bot.username ?? bot.id} em "${chat.name ?? chatId}"`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { label: 'Telegram', ok: false, detail: message };
  }
}

/**
 * Diferente do WhatsApp e do ML, não há sessão em disco: o Telegram é stateless
 * e a "conexão" é o token falando com a Bot API. Por isso conferimos de fato com
 * a API — é a única forma de saber se o bot ainda é admin do canal.
 */
export async function getTelegramSessionStatus(): Promise<SessionStatus> {
  if (!isTelegramIntegrationEnabled()) {
    return {
      label: 'Telegram',
      ok: false,
      detail: 'Desativado — configure em Contas',
    };
  }

  const { botToken, chatId } = getTelegramIntegration();
  const { getBotIdentity, validateTelegramChat } = await import('../../src/telegram/index.js');

  try {
    const bot = await getBotIdentity(botToken);
    const chat = await validateTelegramChat(chatId, botToken);
    if (!chat.valid) {
      return { label: 'Telegram', ok: false, detail: chat.reason ?? 'Canal inválido' };
    }
    return {
      label: 'Telegram',
      ok: true,
      detail: `Bot @${bot.username ?? bot.id} em "${chat.name ?? chatId}"`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { label: 'Telegram', ok: false, detail: message };
  }
}
