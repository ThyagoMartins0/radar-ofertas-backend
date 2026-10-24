import { z } from 'zod';

import { CHANNELS } from '../../src/channels/types.js';

export const workerQuerySchema = z.object({
  channel: z.enum(CHANNELS).optional(),
  accountId: z.string().trim().optional(),
});
