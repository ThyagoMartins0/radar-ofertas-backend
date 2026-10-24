import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  collectOffersHandler,
  getDashboardHandler,
  getMetricsHandler,
} from '../controllers/dashboard.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const dashboardRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/dashboard', { preHandler: authenticate }, getDashboardHandler);
  app.post('/offers/collect', { preHandler: authenticate }, collectOffersHandler);
  app.get('/metrics', { preHandler: authenticate }, getMetricsHandler);
};
