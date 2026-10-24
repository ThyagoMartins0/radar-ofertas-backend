import { createServer, type Server } from 'node:http';

import { env } from '../src/config/env.js';
import { bootstrapCacheCoherence } from '../src/utils/config-cache-sync.js';
import { hydrateIntegrationState } from '../src/channels/integration-state.js';
import { logger } from '../src/utils/logger.js';
import { buildApiApp, type ApiApp } from './app.js';
import { shutdownApi } from './lib/shutdown.js';
import { ensureDefaultAdmin } from './services/auth.service.js';

let extraHttpServer: Server | undefined;

function isDockerRuntime(): boolean {
  return process.env.RUNNING_IN_DOCKER === '1' || process.env.RUNNING_IN_DOCKER === 'true';
}

async function listenExtraPort(app: ApiApp, port: number): Promise<void> {
  extraHttpServer = createServer((req, res) => {
    app.server.emit('request', req, res);
  });

  await new Promise<void>((resolve, reject) => {
    extraHttpServer?.once('error', reject);
    extraHttpServer?.listen(port, '0.0.0.0', () => {
      resolve();
    });
  });

  logger.info({ port }, 'API também escutando para o proxy do Dokploy');
}

export async function startApiServer(): Promise<ApiApp> {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET é obrigatório — defina no .env (mínimo 32 caracteres)');
  }

  if (!env.REDIS_ENABLED) {
    throw new Error('REDIS_ENABLED=true é obrigatório para refresh tokens JWT');
  }

  const app = await buildApiApp();

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.API_PORT }, 'API REST disponível em /api/v1');

  if (isDockerRuntime() && env.API_PORT !== 80) {
    try {
      await listenExtraPort(app, 80);
    } catch (error) {
      logger.warn({ err: error }, 'Bind na porta 80 falhou — Container Port deve ser igual a API_PORT');
    }
  }

  try {
    await ensureDefaultAdmin();
  } catch (error) {
    logger.error(
      { err: error },
      'Banco indisponível no bootstrap — GET / no ar; login falha até MySQL/Redis responderem',
    );
  }

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
  extraHttpServer?.close();
  extraHttpServer = undefined;
  if (appInstance) {
    await appInstance.close();
  }
  await shutdownApi();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
