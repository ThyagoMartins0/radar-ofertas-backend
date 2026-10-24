import type { PlaceholderVisibility } from '../../src/offers/message-template.js';
import type { CouponPlaceholderVisibility } from '../../src/offers/coupon-template.js';
import { toDatetimeLocalInputValue } from '../../src/utils/datetime.js';
import type { z } from 'zod';
import type { autoMessageBodySchema } from '../schemas/template.schemas.js';

export function placeholderVisibilityToForm(
  visibility: PlaceholderVisibility | Record<string, boolean>,
  prefix: 'placeholder' | 'coupon_placeholder',
): Record<string, string> {
  const form: Record<string, string> = {};
  for (const [key, enabled] of Object.entries(visibility)) {
    form[`${prefix}_${key}`] = enabled ? '1' : '0';
  }
  return form;
}

export function autoMessageBodyToForm(
  body: z.infer<typeof autoMessageBodySchema>,
): Record<string, string> {
  const form: Record<string, string> = {
    title: body.title,
    content: body.content,
    scheduleType: body.scheduleType,
    enabled: body.enabled ? '1' : '0',
  };

  if (body.scheduledAt) {
    form.scheduledAt = toDatetimeLocalInputValue(new Date(body.scheduledAt));
  }
  if (body.dailyTime) {
    form.dailyTime = body.dailyTime;
  }

  return form;
}

export type { PlaceholderVisibility, CouponPlaceholderVisibility };
