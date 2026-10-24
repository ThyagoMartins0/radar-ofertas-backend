import { z } from 'zod';
import {
  ACCOUNT_PLATFORMS,
  isAccountPlatform,
  type Account,
  type AccountPlatform,
  type MercadoLivreAccountConfig,
  type TelegramAccountConfig,
  type WhatsAppAccountConfig,
} from './types.js';

const whatsAppDestinationSchema = z.object({
  id: z.string().min(1),
  jid: z.string(),
  kind: z.enum(['newsletter', 'group']),
  label: z.string().nullable().optional(),
  inviteLink: z.string().nullable().optional(),
  enabled: z.boolean(),
});

const whatsAppConfigSchema = z.object({
  channelId: z.string(),
  authPath: z.string(),
  channelName: z.string().nullable().optional(),
  inviteLink: z.string().nullable().optional(),
  destinations: z.array(whatsAppDestinationSchema).optional(),
});

const telegramConfigSchema = z.object({
  botToken: z.string(),
  chatId: z.string(),
});

const mercadoLivreConfigSchema = z.object({
  authPath: z.string(),
  affiliateTag: z.string().optional().default(''),
});

const accountRecordSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(ACCOUNT_PLATFORMS),
  label: z.string().min(1),
  enabled: z.boolean(),
  config: z.unknown(),
});

export function parseAccountConfig(
  platform: AccountPlatform,
  config: unknown,
): WhatsAppAccountConfig | TelegramAccountConfig | MercadoLivreAccountConfig {
  if (platform === 'whatsapp') return whatsAppConfigSchema.parse(config);
  if (platform === 'telegram') return telegramConfigSchema.parse(config);
  return mercadoLivreConfigSchema.parse(config);
}

export function parseAccountRecord(data: unknown): Account {
  const base = accountRecordSchema.parse(data);
  const config = parseAccountConfig(base.platform, base.config);
  return { ...base, config } as Account;
}

export function parseAccountRow(row: {
  id: string;
  platform: string;
  label: string;
  enabled: boolean;
  config: unknown;
}): Account {
  if (!isAccountPlatform(row.platform)) {
    throw new Error(`Plataforma de conta inválida: ${row.platform}`);
  }

  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    enabled: row.enabled,
    config: parseAccountConfig(row.platform, row.config),
  } as Account;
}
