import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
} from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const AUTH_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
} as const;

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/auth/login', AUTH_RATE_LIMIT, loginHandler);
  app.post('/auth/refresh', AUTH_RATE_LIMIT, refreshHandler);
  app.post('/auth/logout', logoutHandler);

  app.get('/auth/me', { preHandler: authenticate }, meHandler);
};
