import type { FastifyInstance } from 'fastify';

import { accountsRoutes } from './accounts.routes.js';
import { authRoutes } from './auth.routes.js';
import { couponsRoutes } from './coupons.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { healthRoutes } from './health.routes.js';
import { logsRoutes } from './logs.routes.js';
import { offersRoutes } from './offers.routes.js';
import { openapiRoutes } from './openapi.routes.js';
import { settingsRoutes } from './settings.routes.js';
import { sourcesRoutes } from './sources.routes.js';
import { templateRoutes } from './template.routes.js';
import { workersRoutes } from './workers.routes.js';

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(openapiRoutes);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(offersRoutes);
  await app.register(settingsRoutes);
  await app.register(logsRoutes);
  await app.register(templateRoutes);
  await app.register(couponsRoutes);
  await app.register(sourcesRoutes);
  await app.register(accountsRoutes);
  await app.register(workersRoutes);
}
