import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  createAutoMessageHandler,
  deleteAutoMessageHandler,
  getTemplateHandler,
  patchCouponTemplateHandler,
  patchOfferTemplateHandler,
  sendAutoMessageHandler,
  updateAutoMessageHandler,
} from '../controllers/template.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const templateRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/template', { preHandler: authenticate }, getTemplateHandler);
  app.patch('/template/offer', { preHandler: authenticate }, patchOfferTemplateHandler);
  app.patch('/template/coupon', { preHandler: authenticate }, patchCouponTemplateHandler);
  app.post('/auto-messages', { preHandler: authenticate }, createAutoMessageHandler);
  app.patch('/auto-messages/:id', { preHandler: authenticate }, updateAutoMessageHandler);
  app.delete('/auto-messages/:id', { preHandler: authenticate }, deleteAutoMessageHandler);
  app.post('/auto-messages/:id/send', { preHandler: authenticate }, sendAutoMessageHandler);
};
