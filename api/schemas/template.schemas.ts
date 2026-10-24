import { z } from 'zod';

import { AUTO_MESSAGE_SCHEDULE_TYPES } from '../../src/auto-messages/types.js';

export const placeholderVisibilitySchema = z.record(z.string(), z.boolean());

export const offerTemplateBodySchema = z.object({
  template: z.string(),
  placeholderVisibility: placeholderVisibilitySchema,
});

export const couponTemplateBodySchema = z.object({
  template: z.string(),
  placeholderVisibility: placeholderVisibilitySchema,
});

export const autoMessageBodySchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  scheduleType: z.enum(AUTO_MESSAGE_SCHEDULE_TYPES).default('manual'),
  scheduledAt: z.string().datetime().optional(),
  dailyTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  enabled: z.boolean().default(true),
});

export const autoMessageIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});
