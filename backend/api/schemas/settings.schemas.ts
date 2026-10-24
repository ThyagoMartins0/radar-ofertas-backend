import { z } from 'zod';

const scoreTierSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number(),
  points: z.number().int(),
});

const scoreCategorySchema = z.object({
  enabled: z.boolean(),
  cumulative: z.boolean(),
  tiers: z.array(scoreTierSchema).min(1),
});

export const scoreConfigBodySchema = z.object({
  minScore: z.number().int().min(0),
  discount: scoreCategorySchema,
  rating: scoreCategorySchema,
  soldQuantity: scoreCategorySchema,
  price: scoreCategorySchema,
});

export const brandBodySchema = z.object({
  name: z.string().trim().min(1),
  subtitle: z.string().trim(),
  logoData: z.string().trim().optional(),
  removeLogo: z.boolean().optional(),
});

export const operatingHoursBodySchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(24),
});

export const sendIntervalBodySchema = z.object({
  intervalMinutes: z.number().int().min(1).max(1440),
});

export const senderDelayBodySchema = z.object({
  senderDelayMinutes: z.number().int().min(0).max(1440),
});

export const couponsUrlBodySchema = z.object({
  couponsUrl: z.string().url(),
});

export const amazonAffiliateBodySchema = z.object({
  baseUrl: z.string().url(),
  affiliateLinkPrefix: z.string(),
  storeId: z.string(),
});

export const amazonCollectionBodySchema = z.object({
  enabled: z.boolean(),
});
