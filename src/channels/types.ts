import type { OfferRecord } from '../offers/types.js';

export const CHANNELS = ['whatsapp', 'telegram'] as const;

export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

export interface ChannelVerifyResult {
  ok: boolean;
  detail: string;
  /**
   * O canal só admite um processo dono da conexão e outro já assumiu (WhatsApp).
   * Não é erro de configuração: o worker duplicado encerra em silêncio (exit 0)
   * em vez de falhar e ser reiniciado em loop pelo Docker.
   */
  duplicate?: boolean;
}

/**
 * Contrato de um canal de publicação. O worker unificado consome todas as filas
 * habilitadas — cada publisher implementa o protocolo do seu canal.
 *
 * Para adicionar um canal: implemente isto, registre em channels/index.ts e inclua
 * no worker unificado (`src/worker.ts`).
 */
export interface ChannelPublisher {
  readonly channel: Channel;
  readonly accountId: string;

  /** O canal está ligado no .env? Um worker de canal desligado encerra no boot. */
  isEnabled(): boolean;

  /** Credenciais e destino conferem? Roda uma vez no boot do worker. */
  verify(): Promise<ChannelVerifyResult>;

  /** Publica a oferta já formatada. Devolve o id da mensagem no canal. */
  publish(offer: OfferRecord, caption: string): Promise<{ messageId: string }>;

  /** Publica texto livre (mensagens automáticas). */
  publishText(text: string): Promise<{ messageId: string }>;

  /** Libera recursos no shutdown (sessões, sockets). Opcional. */
  shutdown?(): Promise<void>;
}
