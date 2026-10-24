import { env } from '../config/env.js';
import type { OfferRecord } from '../offers/types.js';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  isPlaceholderChannelId,
  requireWhatsAppSocket,
  sendOffer,
  validateWhatsAppChannel,
  WhatsAppOwnedElsewhereError,
} from '../whatsapp/index.js';
import type { ChannelPublisher } from './types.js';

export const whatsappPublisher: ChannelPublisher = {
  channel: 'whatsapp',
  accountId: 'default',

  isEnabled: () => true,

  async verify() {
    if (isPlaceholderChannelId(env.WHATSAPP_CHANNEL_ID)) {
      return {
        ok: false,
        detail:
          'WHATSAPP_CHANNEL_ID é placeholder — rode npm run wa:channel com o link do seu canal',
      };
    }

    try {
      const sock = await connectWhatsApp();
      const channel = await validateWhatsAppChannel(sock, env.WHATSAPP_CHANNEL_ID);

      if (!channel.valid) {
        return {
          ok: false,
          detail: `Canal inválido (${channel.reason}) — rode npm run wa:channel para obter o JID correto`,
        };
      }

      return { ok: true, detail: `Canal "${channel.name ?? env.WHATSAPP_CHANNEL_ID}" validado` };
    } catch (error) {
      if (error instanceof WhatsAppOwnedElsewhereError) {
        // A sessão só admite um dono. Este processo é duplicado: não é erro de
        // configuração, então sinalizamos para encerrar em silêncio.
        return {
          ok: false,
          duplicate: true,
          detail: 'A sessão do WhatsApp já está ativa em outro processo',
        };
      }
      throw error;
    }
  },

  async publish(offer: OfferRecord, caption: string) {
    // Obtemos o socket vivo a cada envio: a conexão pode cair e reconectar (novo
    // socket), então um socket capturado no boot ficaria obsoleto e lançaria
    // "Connection Closed".
    const sock = await requireWhatsAppSocket();
    const result = await sendOffer(sock, env.WHATSAPP_CHANNEL_ID, offer.image, caption);
    return { messageId: result.key.id ?? '' };
  },

  async publishText(text: string) {
    const sock = await requireWhatsAppSocket();
    const result = await sendOffer(sock, env.WHATSAPP_CHANNEL_ID, null, text);
    return { messageId: result.key.id ?? '' };
  },

  async shutdown() {
    // Libera o lock de dono da sessão para que um restart rápido (painel / watch)
    // consiga reassumir o WhatsApp em vez de se ver como duplicado.
    await disconnectWhatsApp().catch(() => {});
  },
};
