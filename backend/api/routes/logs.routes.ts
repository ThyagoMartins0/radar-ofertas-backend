import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { getLogsHandler, streamLogsHandler } from '../controllers/logs.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const logsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/logs', { preHandler: authenticate }, getLogsHandler);
  app.get('/logs/stream', { preHandler: authenticate }, streamLogsHandler);
};
