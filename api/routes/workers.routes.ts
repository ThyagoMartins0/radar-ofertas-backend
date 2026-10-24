import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  getPrismaStatusHandler,
  getWorkerStatusHandler,
  restartWorkerHandler,
  runPrismaGenerateHandler,
  startWorkerHandler,
  stopWorkerHandler,
} from '../controllers/workers.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const workersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/worker/status', { preHandler: authenticate }, getWorkerStatusHandler);
  app.post('/worker/start', { preHandler: authenticate }, startWorkerHandler);
  app.post('/worker/stop', { preHandler: authenticate }, stopWorkerHandler);
  app.post('/worker/restart', { preHandler: authenticate }, restartWorkerHandler);
  app.get('/prisma/status', { preHandler: authenticate }, getPrismaStatusHandler);
  app.post('/prisma/generate', { preHandler: authenticate }, runPrismaGenerateHandler);
};
