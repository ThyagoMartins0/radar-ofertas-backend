import type { Account, WhatsAppAccount, TelegramAccount } from '../accounts/types.js';
import {
  getEnabledWhatsAppDestinations,
  listWhatsAppDestinations,
} from '../accounts/whatsapp-destinations.js';
import { findAccount, invalidateAccountsCache, resolveAccountAuthPath } from '../accounts/repository.js';
import type { ChannelPublisher } from './types.js';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppSocket,
  isPlaceholderChannelId,
  requireWhatsAppSocket,
  sendOffer,
  validateWhatsAppDestination,
  WhatsAppOwnedElsewhereError,
} from '../whatsapp/index.js';
import { resolveWhatsAppInvite } from '../whatsapp/invite.js';
import {
  getBotIdentity,
  sendOffer as sendTelegramOffer,
  validateTelegramChat,
} from '../telegram/index.js';
import type { OfferRecord } from '../offers/types.js';
import { logger } from '../utils/logger.js';

async function resolveDestinationJid(
  sock: Awaited<ReturnType<typeof connectWhatsApp>>,
  destination: ReturnType<typeof listWhatsAppDestinations>[number],
): Promise<string> {
  if (destination.jid.trim()) return destination.jid.trim();
  if (!destination.inviteLink?.trim()) {
    throw new Error(`Destino "${destination.label ?? destination.id}" sem JID ou link`);
  }

  const resolved = await resolveWhatsAppInvite(sock, destination.inviteLink);
  return resolved.jid;
}

/** Conta fresca do DB — o cache em memória do worker pode atrasar o invalidation Redis. */
async function loadWhatsAppAccount(accountId: string): Promise<WhatsAppAccount> {
  invalidateAccountsCache();
  const current = await findAccount(accountId, 'whatsapp');
  if (!current || current.platform !== 'whatsapp') {
    throw new Error(`Conta WhatsApp "${accountId}" não encontrada`);
  }
  return current;
}

async function loadTelegramAccount(accountId: string): Promise<TelegramAccount> {
  invalidateAccountsCache();
  const current = await findAccount(accountId, 'telegram');
  if (!current || current.platform !== 'telegram') {
    throw new Error(`Conta Telegram "${accountId}" não encontrada`);
  }
  return current;
}

async function publishToWhatsAppDestinations(
  accountId: string,
  authPath: string,
  image: string | null,
  caption: string,
): Promise<{ messageId: string }> {
  // Relê a conta a cada envio — o config do boot fica stale após Configurar no painel.
  const account = await loadWhatsAppAccount(accountId);
  const destinations = getEnabledWhatsAppDestinations(account.config);

  if (destinations.length === 0) {
    throw new Error(
      'Nenhum destino WhatsApp configurado — use Configurar na conta e salve o link do canal',
    );
  }

  const sock = await requireWhatsAppSocket(authPath);
  let lastMessageId = '';
  const failures: string[] = [];

  for (const destination of destinations) {
    try {
      const jid = await resolveDestinationJid(sock, destination);
      const validation = await validateWhatsAppDestination(sock, jid, {
        inviteLink: destination.inviteLink,
      });
      if (!validation.valid) {
        const reason = validation.reason ?? 'inválido';
        failures.push(`${destination.label ?? jid}: ${reason}`);
        logger.warn(
          { jid, label: destination.label, reason },
          'Destino WhatsApp ignorado no envio',
        );
        continue;
      }

      const result = await sendOffer(sock, jid, image, caption);
      lastMessageId = result.key.id ?? lastMessageId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${destination.label ?? destination.jid}: ${message}`);
      logger.warn(
        { error, label: destination.label, jid: destination.jid },
        'Falha ao publicar em destino WhatsApp',
      );
    }
  }

  if (!lastMessageId) {
    throw new Error(
      failures.length > 0
        ? `Nenhum destino WhatsApp aceitou o envio (${failures.join(' · ')})`
        : 'Nenhum destino WhatsApp aceitou o envio',
    );
  }

  return { messageId: lastMessageId };
}

export function createWhatsAppPublisher(account: WhatsAppAccount): ChannelPublisher {
  const { id } = account;
  const authPath = resolveAccountAuthPath(id, 'whatsapp');

  return {
    channel: 'whatsapp',
    accountId: id,

    isEnabled: () => account.enabled,

    async verify() {
      const current = await loadWhatsAppAccount(id);
      const destinations = getEnabledWhatsAppDestinations(current.config);

      try {
        // Sem destinos: não espera o open (QR pode levar minutos). O timeout antigo
        // derrubava o worker inteiro e o painel mostrava login + logo "deslogado".
        if (destinations.length === 0) {
          if (!getWhatsAppSocket(authPath)) {
            void connectWhatsApp({ authPath, accountId: id }).catch((error: unknown) => {
              if (error instanceof WhatsAppOwnedElsewhereError) return;
              logger.warn({ error, accountId: id }, 'Pareamento WhatsApp encerrado antes do open');
            });
          }
          return {
            ok: true,
            detail:
              'WhatsApp em pareamento — escaneie o QR no painel e configure destinos para enviar ofertas',
          };
        }

        const sock = await connectWhatsApp({ authPath, accountId: id });
        const failures: string[] = [];
        let validCount = 0;

        for (const destination of destinations) {
          const jid = await resolveDestinationJid(sock, destination);
          if (isPlaceholderChannelId(jid)) {
            failures.push(`${destination.label ?? jid}: ID placeholder inválido`);
            continue;
          }

          const validation = await validateWhatsAppDestination(sock, jid, {
            inviteLink: destination.inviteLink,
          });
          if (!validation.valid) {
            failures.push(`${destination.label ?? jid}: ${validation.reason}`);
            continue;
          }

          validCount += 1;
        }

        if (validCount === 0) {
          return { ok: false, detail: failures.join(' · ') };
        }

        const detail =
          failures.length > 0
            ? `${validCount} destino(s) ativo(s); ignorando: ${failures.join(' · ')}`
            : `${validCount} destino(s) WhatsApp validado(s)`;

        return { ok: true, detail };
      } catch (error) {
        if (error instanceof WhatsAppOwnedElsewhereError) {
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
      return publishToWhatsAppDestinations(id, authPath, offer.image, caption);
    },

    async publishText(text: string) {
      return publishToWhatsAppDestinations(id, authPath, null, text);
    },

    async shutdown() {
      await disconnectWhatsApp(authPath).catch(() => {});
    },
  };
}

export function createTelegramPublisher(account: TelegramAccount): ChannelPublisher {
  const { id } = account;

  return {
    channel: 'telegram',
    accountId: id,

    isEnabled: () => account.enabled,

    async verify() {
      const current = await loadTelegramAccount(id);
      const { botToken, chatId } = current.config;

      if (!botToken || !chatId) {
        return {
          ok: false,
          detail: 'Token ou canal vazios — configure em Configuração › Integrador no painel',
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
      const current = await loadTelegramAccount(id);
      const result = await sendTelegramOffer(
        current.config.chatId,
        offer.image,
        caption,
        current.config.botToken,
      );
      return { messageId: String(result.message_id) };
    },

    async publishText(text: string) {
      const current = await loadTelegramAccount(id);
      const result = await sendTelegramOffer(
        current.config.chatId,
        null,
        text,
        current.config.botToken,
      );
      return { messageId: String(result.message_id) };
    },
  };
}

export function createPublisher(account: Account): ChannelPublisher {
  switch (account.platform) {
    case 'whatsapp':
      return createWhatsAppPublisher(account);
    case 'telegram':
      return createTelegramPublisher(account);
    case 'mercado_livre':
      throw new Error('Mercado Livre não é um canal de publicação');
  }
}
