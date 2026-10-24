import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  addAmazonSourceHandler,
  addMlSourceHandler,
  deleteAmazonSourceHandler,
  deleteMlSourceHandler,
  getSourcesHandler,
  patchSourcesHandler,
} from '../controllers/sources.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const sourcesRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/sources/:channel', { preHandler: authenticate }, getSourcesHandler);
  app.patch('/sources/:channel', { preHandler: authenticate }, patchSourcesHandler);
  app.post('/sources/:channel/ml', { preHandler: authenticate }, addMlSourceHandler);
  app.post('/sources/:channel/amazon', { preHandler: authenticate }, addAmazonSourceHandler);
  app.delete('/sources/:channel/ml/:sourceId', { preHandler: authenticate }, deleteMlSourceHandler);
  app.delete(
    '/sources/:channel/amazon/:sourceId',
    { preHandler: authenticate },
    deleteAmazonSourceHandler,
  );
};
