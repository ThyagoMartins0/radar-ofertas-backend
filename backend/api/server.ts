import { env } from '../src/config/env.js';
import { bootstrapCacheCoherence } from '../src/utils/config-cache-sync.js';
import { hydrateIntegrationState } from '../src/channels/integration-state.js';
import { logger } from '../src/utils/logger.js';
import { buildApiApp, type ApiApp } from './app.js';
import { shutdownApi } from './lib/shutdown.js';
import { ensureDefaultAdmin } from './services/auth.service.js';

export async function startApiServer(): Promise<ApiApp> {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET é obrigatório — defina no .env (mínimo 32 caracteres)');
  }

  if (!env.REDIS_ENABLED) {
    throw new Error('REDIS_ENABLED=true é obrigatório para refresh tokens JWT');
  }

  await ensureDefaultAdmin();

  const app = await buildApiApp();

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.API_PORT }, 'API REST disponível em /api/v1');

  void bootstrapCacheCoherence();
  void hydrateIntegrationState();

  return app;
}

const serverPromise = startApiServer();
let appInstance: ApiApp | undefined;

serverPromise
  .then((app) => {
    appInstance = app;
  })
  .catch((error) => {
    logger.error({ err: error }, 'Falha ao subir API REST');
    process.exit(1);
  });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Encerrando API REST');
  if (appInstance) {
    await appInstance.close();
  }
  await shutdownApi();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
