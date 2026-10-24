import type { OfferRecord } from '../offers/types.js';
import {
  getBotIdentity,
  hasTelegramCredentials,
  sendOffer,
  validateTelegramChat,
} from '../telegram/index.js';
import { getTelegramIntegration, isTelegramIntegrationEnabled } from './integration-state.js';
import type { ChannelPublisher } from './types.js';

export const telegramPublisher: ChannelPublisher = {
  channel: 'telegram',
  accountId: 'default',

  isEnabled: () => isTelegramIntegrationEnabled(),

  async verify() {
    const { botToken, chatId } = getTelegramIntegration();
    if (!hasTelegramCredentials(botToken, chatId)) {
      return {
        ok: false,
        detail: 'Telegram não configurado — preencha token e canal em Configuração › Integrador',
      };
    }

    try {
      const bot = await getBotIdentity(botToken);
      const chat = await validateTelegramChat(chatId, botToken);

      if (!chat.valid) {
        return { ok: false, detail: `Chat inválido: ${chat.reason}` };
      }

      return {
        ok: true,
        detail: `Bot @${bot.username ?? bot.id} publicando em "${chat.name ?? chatId}"`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: message };
    }
  },

  async publish(offer: OfferRecord, caption: string) {
    const { botToken, chatId } = getTelegramIntegration();
    const result = await sendOffer(chatId, offer.image, caption, botToken);
    return { messageId: String(result.message_id) };
  },

  async publishText(text: string) {
    const { botToken, chatId } = getTelegramIntegration();
    const result = await sendOffer(chatId, null, text, botToken);
    return { messageId: String(result.message_id) };
  },
};
