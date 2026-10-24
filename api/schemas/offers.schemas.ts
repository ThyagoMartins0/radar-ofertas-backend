import { z } from 'zod';

export const offersListQuerySchema = z.object({
  status: z.enum(['all', 'pending', 'sent', 'error']).default('all'),
  origin: z.enum(['all', 'mercado_livre', 'amazon']).default('all'),
  destination: z.enum(['all', 'whatsapp', 'telegram']).default('all'),
  page: z.coerce.number().int().positive().default(1),
});

export const searchLimitBodySchema = z.object({
  searchLimit: z.number().int().min(1).max(500),
});

export const collectOffersBodySchema = z
  .object({
    productName: z.string().trim().min(1).max(200).optional(),
    searchLimit: z.number().int().min(1).max(50).optional(),
    sendAfterCollect: z.boolean().default(false),
    sendDelayMinutes: z.number().int().min(1).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sendAfterCollect && value.sendDelayMinutes == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe o delay em minutos quando enviar ao finalizar',
        path: ['sendDelayMinutes'],
      });
    }
  });

export const affiliateDelayBodySchema = z.object({
  affiliateDelayMs: z.number().int().min(0).max(60_000),
  affiliateBacklogDelayMinutes: z.number().int().min(1).max(60),
  affiliateBacklogThreshold: z.number().int().min(1).max(100),
});

export const offerIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});
