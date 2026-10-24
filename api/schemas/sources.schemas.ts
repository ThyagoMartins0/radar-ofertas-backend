import { z } from 'zod';

import { CHANNELS } from '../../src/channels/types.js';

export const channelParamsSchema = z.object({
  channel: z.enum(CHANNELS),
});

const sourceFlagSchema = z.object({
  id: z.string().trim().min(1),
  enabled: z.boolean(),
});

const envSourceFlagSchema = z.object({
  index: z.number().int().min(0),
  enabled: z.boolean(),
});

export const patchSourcesBodySchema = z.object({
  ml: z
    .object({
      env: z.array(envSourceFlagSchema).optional(),
      custom: z.array(sourceFlagSchema).optional(),
    })
    .optional(),
  amazon: z
    .object({
      env: z.array(envSourceFlagSchema).optional(),
      custom: z.array(sourceFlagSchema).optional(),
    })
    .optional(),
});

export const addSourceBodySchema = z.object({
  url: z.string().url(),
  label: z.string().trim().optional(),
});

export const sourceIdParamsSchema = z.object({
  channel: z.enum(CHANNELS),
  sourceId: z.string().trim().min(1),
});

export function buildSourceFlagsForm(body: z.infer<typeof patchSourcesBodySchema>): Record<string, string> {
  const form: Record<string, string> = {};

  for (const item of body.ml?.env ?? []) {
    form[`coletar_env:${item.index}`] = item.enabled ? '1' : '0';
  }
  for (const item of body.ml?.custom ?? []) {
    form[`coletar_${item.id}`] = item.enabled ? '1' : '0';
  }
  for (const item of body.amazon?.env ?? []) {
    form[`coletar_amazon_env:${item.index}`] = item.enabled ? '1' : '0';
  }
  for (const item of body.amazon?.custom ?? []) {
    form[`coletar_amazon_${item.id}`] = item.enabled ? '1' : '0';
  }

  return form;
}
