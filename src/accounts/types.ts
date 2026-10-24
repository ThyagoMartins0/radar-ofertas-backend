/** Plataformas que exigem conta/sessão própria (distinto de Channel de publicação). */
export const ACCOUNT_PLATFORMS = ['whatsapp', 'telegram', 'mercado_livre'] as const;

export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

/** ID da conta padrão — espelha a configuração única do .env até multi-conta estar ativo. */
export const DEFAULT_ACCOUNT_ID = 'default';

export type WhatsAppDestinationKind = 'newsletter' | 'group';

export interface WhatsAppDestination {
  id: string;
  jid: string;
  kind: WhatsAppDestinationKind;
  label?: string | null;
  inviteLink?: string | null;
  enabled: boolean;
}

export interface WhatsAppAccountConfig {
  channelId: string;
  authPath: string;
  channelName?: string | null;
  inviteLink?: string | null;
  destinations?: WhatsAppDestination[];
}

export interface TelegramAccountConfig {
  botToken: string;
  chatId: string;
}

export interface MercadoLivreAccountConfig {
  authPath: string;
  /** Tag do programa de afiliados ML (matt_tool). Vazio usa AFFILIATE_CONFIG do .env. */
  affiliateTag?: string;
}

export interface WhatsAppAccount {
  id: string;
  platform: 'whatsapp';
  label: string;
  enabled: boolean;
  config: WhatsAppAccountConfig;
}

export interface TelegramAccount {
  id: string;
  platform: 'telegram';
  label: string;
  enabled: boolean;
  config: TelegramAccountConfig;
}

export interface MercadoLivreAccount {
  id: string;
  platform: 'mercado_livre';
  label: string;
  enabled: boolean;
  config: MercadoLivreAccountConfig;
}

export type Account = WhatsAppAccount | TelegramAccount | MercadoLivreAccount;

export function isAccountPlatform(value: string): value is AccountPlatform {
  return (ACCOUNT_PLATFORMS as readonly string[]).includes(value);
}

export function accountPlatformLabel(platform: AccountPlatform): string {
  if (platform === 'whatsapp') return 'WhatsApp';
  if (platform === 'telegram') return 'Telegram';
  return 'Mercado Livre';
}
