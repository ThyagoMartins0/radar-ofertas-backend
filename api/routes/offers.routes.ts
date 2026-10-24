import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  deleteOfferHandler,
  deletePendingOffersHandler,
  getOfferHandler,
  listOffersHandler,
  patchAffiliateDelayHandler,
  patchSearchLimitHandler,
  sendOfferNowHandler,
} from '../controllers/offers.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const offersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/offers', { preHandler: authenticate }, listOffersHandler);
  app.get('/offers/:id', { preHandler: authenticate }, getOfferHandler);
  app.patch('/offers/settings/search-limit', { preHandler: authenticate }, patchSearchLimitHandler);
  app.patch(
    '/offers/settings/affiliate-delay',
    { preHandler: authenticate },
    patchAffiliateDelayHandler,
  );
  app.post('/offers/:id/send-now', { preHandler: authenticate }, sendOfferNowHandler);
  app.delete('/offers/pending', { preHandler: authenticate }, deletePendingOffersHandler);
  app.delete('/offers/:id', { preHandler: authenticate }, deleteOfferHandler);
};
