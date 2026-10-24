import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Bot API pura sobre fetch — o uso aqui é só publicar foto+legenda num canal,
// então uma dependência de client completo não se paga. Espelha o formato de
// whatsapp/index.ts: validação do destino, envio com imagem e fallback texto.

const API_BASE = 'https://api.telegram.org';

/** Legenda de foto no Telegram tem limite duro de 1024; mensagem de texto, 4096. */
const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4096;

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

/** Erro da própria Bot API (já com contexto do método chamado). */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
    readonly errorCode?: number,
    /** Presente em 429: segundos que a API pede para esperar. */
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${method} falhou: ${description}`);
    this.name = 'TelegramApiError';
  }
}

function resolveBotToken(override?: string): string {
  const token = override?.trim() || env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'Token do bot não configurado — preencha em Configuração › Integrador no painel',
    );
  }
  return token;
}

async function callApi<T>(
  method: string,
  body: FormData | Record<string, unknown>,
  botTokenOverride?: string,
): Promise<T> {
  const isForm = body instanceof FormData;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.TELEGRAM_API_TIMEOUT_MS);
  const token = resolveBotToken(botTokenOverride);

  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = (await response.json()) as TelegramResponse<T>;

    if (!payload.ok || payload.result === undefined) {
      throw new TelegramApiError(
        method,
        payload.description ?? `HTTP ${response.status}`,
        payload.error_code,
        payload.parameters?.retry_after,
      );
    }

    return payload.result;
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Telegram ${method} excedeu ${env.TELEGRAM_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** O token é válido? Usado no boot do worker e no preflight. */
export async function getBotIdentity(botTokenOverride?: string): Promise<TelegramUser> {
  return callApi<TelegramUser>('getMe', {}, botTokenOverride);
}

export function hasTelegramCredentials(
  botTokenOverride?: string,
  chatIdOverride?: string,
): boolean {
  const token = botTokenOverride?.trim() || env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride?.trim() || env.TELEGRAM_CHAT_ID;
  return Boolean(token && chatId);
}

/**
 * O bot alcança o chat e pode postar nele? getChat só prova que o destino existe,
 * então também exigimos que o bot seja admin em canal/supergrupo — sem isso o
 * primeiro envio é que falharia, já em produção.
 */
export async function validateTelegramChat(
  chatId: string,
  botTokenOverride?: string,
): Promise<{ valid: boolean; name?: string; reason?: string }> {
  if (!chatId.trim()) {
    return { valid: false, reason: 'Canal vazio — use @seucanal ou o id numérico (-100…)' };
  }

  try {
    const chat = await callApi<TelegramChat>('getChat', { chat_id: chatId }, botTokenOverride);
    const name = chat.title ?? chat.username ?? String(chat.id);

    if (chat.type === 'channel' || chat.type === 'supergroup') {
      const me = await getBotIdentity(botTokenOverride);
      const member = await callApi<{ status: string; can_post_messages?: boolean }>(
        'getChatMember',
        { chat_id: chatId, user_id: me.id },
        botTokenOverride,
      );

      if (member.status !== 'administrator' && member.status !== 'creator') {
        return {
          valid: false,
          name,
          reason: `O bot não é admin de "${name}" — adicione-o como administrador do canal`,
        };
      }

      if (chat.type === 'channel' && member.can_post_messages === false) {
        return {
          valid: false,
          name,
          reason: `O bot é admin de "${name}" mas sem permissão de publicar mensagens`,
        };
      }
    }

    return { valid: true, name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: message };
  }
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Publica a oferta no chat. Com imagem usamos sendPhoto pedindo à própria API que
 * baixe a URL (photo como string) — evita puxar os bytes para cá. Se o Telegram
 * não conseguir buscar a imagem, cai para texto puro, igual ao WhatsApp.
 *
 * O template é texto puro (sem markup), então enviamos sem parse_mode: assim
 * qualquer `_`, `*` ou `[` vindo do título do produto não quebra o envio.
 */
export async function sendOffer(
  chatId: string,
  imageUrl: string | null,
  caption: string,
  botTokenOverride?: string,
): Promise<TelegramMessage> {
  if (imageUrl) {
    try {
      const result = await callApi<TelegramMessage>(
        'sendPhoto',
        {
          chat_id: chatId,
          photo: imageUrl,
          caption: truncate(caption, CAPTION_LIMIT),
        },
        botTokenOverride,
      );

      logger.info(
        { chatId, messageId: result.message_id, mode: 'image' },
        'Offer sent to Telegram channel',
      );
      return result;
    } catch (error) {
      // 429 (flood) é problema de ritmo, não da imagem: repassamos para o BullMQ
      // retentar em vez de degradar silenciosamente para texto.
      if (error instanceof TelegramApiError && error.errorCode === 429) throw error;
      logger.warn({ error, imageUrl }, 'Falha no envio com imagem no Telegram — enviando só texto');
    }
  }

  const result = await callApi<TelegramMessage>(
    'sendMessage',
    {
      chat_id: chatId,
      text: truncate(caption, TEXT_LIMIT),
      link_preview_options: { is_disabled: false },
    },
    botTokenOverride,
  );

  logger.info(
    { chatId, messageId: result.message_id, mode: 'text' },
    'Offer sent to Telegram channel',
  );
  return result;
}
