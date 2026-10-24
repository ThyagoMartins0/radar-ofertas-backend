import { telegramPublisher } from './telegram-publisher.js';
import {
  isTelegramIntegrationEnabled,
  isWhatsAppIntegrationConfigured,
} from './integration-state.js';
import { CHANNELS, type Channel, type ChannelPublisher } from './types.js';
import { whatsappPublisher } from './whatsapp-publisher.js';

export { CHANNELS, CHANNEL_LABELS, isChannel } from './types.js';
export type { Channel, ChannelPublisher, ChannelVerifyResult } from './types.js';

const PUBLISHERS: Record<Channel, ChannelPublisher> = {
  whatsapp: whatsappPublisher,
  telegram: telegramPublisher,
};

export function getPublisher(channel: Channel): ChannelPublisher {
  return PUBLISHERS[channel];
}

/**
 * Canais com integração configurada no painel (contas + destinos).
 * Um canal desligado ou sem credenciais nunca recebe oferta enfileirada.
 */
export function getEnabledChannels(): Channel[] {
  return CHANNELS.filter((channel) => isChannelEnabled(channel));
}

export function isChannelEnabled(channel: Channel): boolean {
  if (channel === 'whatsapp') return isWhatsAppIntegrationConfigured();
  return isTelegramIntegrationEnabled();
}
