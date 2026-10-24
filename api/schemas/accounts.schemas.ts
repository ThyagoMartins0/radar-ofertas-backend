import { z } from 'zod';

import { ACCOUNT_PLATFORMS } from '../../src/accounts/types.js';

export const accountIdParamsSchema = z.object({
  accountId: z.string().trim().min(1),
});

export const accountPlatformParamsSchema = z.object({
  accountId: z.string().trim().min(1),
  platform: z.enum(ACCOUNT_PLATFORMS),
});

export const addAccountBodySchema = z.object({
  platform: z.enum(ACCOUNT_PLATFORMS),
  label: z.string().trim().min(1),
});

export const whatsAppChannelBodySchema = z.object({
  inviteLink: z.string().trim().min(1),
});

export const whatsAppDestinationBodySchema = z.object({
  inviteInput: z.string().trim().min(1),
});

export const whatsAppDestinationIdBodySchema = z.object({
  destinationId: z.string().trim().min(1),
});

export const whatsAppDestinationToggleBodySchema = z.object({
  destinationId: z.string().trim().min(1),
  enabled: z.boolean(),
});

export const telegramConfigBodySchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string(),
  chatId: z.string(),
});

export const mercadoLivreConfigBodySchema = z.object({
  affiliateTag: z.string(),
});
