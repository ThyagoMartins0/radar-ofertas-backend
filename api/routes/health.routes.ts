import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  collectorHealthHandler,
  healthHandler,
  workerHealthHandler,
} from '../controllers/health.controller.js';

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/health', healthHandler);
  app.get('/health/collector', collectorHealthHandler);
  app.get('/health/worker', workerHealthHandler);
};
