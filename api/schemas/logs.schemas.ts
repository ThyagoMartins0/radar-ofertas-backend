import { z } from 'zod';

export const logsQuerySchema = z.object({
  level: z
    .enum(['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('all'),
  source: z.enum(['all', 'collector', 'worker', 'api', 'manager']).default('all'),
  limit: z.coerce.number().int().min(50).max(1000).default(200),
  since: z.string().optional(),
  mlSince: z.string().optional(),
});

export const logsStreamQuerySchema = logsQuerySchema.pick({ level: true, source: true });
