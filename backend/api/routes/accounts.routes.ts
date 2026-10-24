import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  addWhatsAppDestinationHandler,
  createAccountHandler,
  deleteAccountHandler,
  listAccountsHandler,
  patchMercadoLivreConfigHandler,
  patchTelegramConfigHandler,
  patchWhatsAppChannelHandler,
  removeWhatsAppDestinationHandler,
  toggleAccountHandler,
  toggleWhatsAppDestinationHandler,
} from '../controllers/accounts.controller.js';
import {
  cancelMercadoLivreConnectHandler,
  finishMercadoLivreConnectHandler,
  getMercadoLivreConnectStatusHandler,
  getWhatsAppConnectStatusHandler,
  startMercadoLivreConnectHandler,
  startWhatsAppConnectHandler,
  verifyTelegramConnectHandler,
} from '../controllers/connections.controller.js';
import { authenticate } from '../middleware/authenticate.js';

export const accountsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/accounts', { preHandler: authenticate }, listAccountsHandler);
  app.post('/accounts', { preHandler: authenticate }, createAccountHandler);
  app.patch(
    '/accounts/:accountId/:platform/toggle',
    { preHandler: authenticate },
    toggleAccountHandler,
  );
  app.delete(
    '/accounts/:accountId/:platform',
    { preHandler: authenticate },
    deleteAccountHandler,
  );
  app.patch(
    '/accounts/:accountId/whatsapp-channel',
    { preHandler: authenticate },
    patchWhatsAppChannelHandler,
  );
  app.post(
    '/accounts/:accountId/whatsapp-destinations',
    { preHandler: authenticate },
    addWhatsAppDestinationHandler,
  );
  app.delete(
    '/accounts/:accountId/whatsapp-destinations',
    { preHandler: authenticate },
    removeWhatsAppDestinationHandler,
  );
  app.patch(
    '/accounts/:accountId/whatsapp-destinations/toggle',
    { preHandler: authenticate },
    toggleWhatsAppDestinationHandler,
  );
  app.patch('/accounts/:accountId/telegram', { preHandler: authenticate }, patchTelegramConfigHandler);
  app.patch(
    '/accounts/:accountId/mercado-livre',
    { preHandler: authenticate },
    patchMercadoLivreConfigHandler,
  );

  app.post(
    '/accounts/:accountId/connect/whatsapp/start',
    { preHandler: authenticate },
    startWhatsAppConnectHandler,
  );
  app.get(
    '/accounts/:accountId/connect/whatsapp/status',
    { preHandler: authenticate },
    getWhatsAppConnectStatusHandler,
  );
  app.post(
    '/accounts/:accountId/connect/mercado-livre/start',
    { preHandler: authenticate },
    startMercadoLivreConnectHandler,
  );
  app.post(
    '/accounts/:accountId/connect/mercado-livre/finish',
    { preHandler: authenticate },
    finishMercadoLivreConnectHandler,
  );
  app.post(
    '/accounts/:accountId/connect/mercado-livre/cancel',
    { preHandler: authenticate },
    cancelMercadoLivreConnectHandler,
  );
  app.get(
    '/accounts/:accountId/connect/mercado-livre/status',
    { preHandler: authenticate },
    getMercadoLivreConnectStatusHandler,
  );
  app.get(
    '/accounts/:accountId/connect/telegram/verify',
    { preHandler: authenticate },
    verifyTelegramConnectHandler,
  );
};
