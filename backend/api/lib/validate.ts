import type { ZodType } from 'zod';

import { ValidationError } from '../errors/api-errors.js';

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Corpo da requisição inválido', parsed.error.flatten());
  }
  return parsed.data;
}

export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ValidationError('Query inválida', parsed.error.flatten());
  }
  return parsed.data;
}
