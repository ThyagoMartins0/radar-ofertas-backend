import { z } from 'zod';

export const couponIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const couponSendBodySchema = z.object({
  code: z.string().trim().optional(),
});

export const couponStoreLinkBodySchema = z.object({
  storeUrl: z.string(),
  code: z.string().trim().optional(),
});
