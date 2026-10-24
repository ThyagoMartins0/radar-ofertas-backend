import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  getSettingsHandler,
  patchAmazonAffiliateHandler,
  patchAmazonCollectionHandler,
  patchBrandHandler,
  patchCouponsUrlHandler,
  patchOperatingHoursHandler,
  patchScoreHandler,
  patchSendIntervalHandler,
  patchSenderDelayHandler,
} from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const settingsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/settings', { preHandler: authenticate }, getSettingsHandler);
  app.patch('/settings/score', { preHandler: authenticate }, patchScoreHandler);
  app.patch('/settings/brand', { preHandler: authenticate }, patchBrandHandler);
  app.patch('/settings/operating-hours', { preHandler: authenticate }, patchOperatingHoursHandler);
  app.patch('/settings/send-interval', { preHandler: authenticate }, patchSendIntervalHandler);
  app.patch('/settings/sender-delay', { preHandler: authenticate }, patchSenderDelayHandler);
  app.patch('/settings/coupons-url', { preHandler: authenticate }, patchCouponsUrlHandler);
  app.patch('/settings/amazon-affiliate', { preHandler: authenticate }, patchAmazonAffiliateHandler);
  app.patch('/settings/amazon-collection', { preHandler: authenticate }, patchAmazonCollectionHandler);
};
