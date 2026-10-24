import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  listCouponsHandler,
  patchCouponStoreLinkHandler,
  refreshCouponsHandler,
  sendCouponHandler,
} from '../controllers/coupons.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const couponsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/coupons', { preHandler: authenticate }, listCouponsHandler);
  app.post('/coupons/refresh', { preHandler: authenticate }, refreshCouponsHandler);
  app.post('/coupons/:id/send', { preHandler: authenticate }, sendCouponHandler);
  app.patch('/coupons/:id/store-link', { preHandler: authenticate }, patchCouponStoreLinkHandler);
};
