import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../src/config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerApiRoutes } from './routes/index.js';

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function resolveCorsOrigins(): string[] {
  if (env.API_CORS_ORIGINS.length > 0) {
    return env.API_CORS_ORIGINS;
  }
  return DEFAULT_DEV_ORIGINS;
}

export async function buildApiApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });

  registerErrorHandler(app);

  await app.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      error: 'Muitas requisições — tente novamente em instantes',
      code: 'RATE_LIMITED',
      details: { retryAfter: context.after },
    }),
  });

  await app.register(cors, {
    origin: resolveCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(
    async (api) => {
      await registerApiRoutes(api);
    },
    { prefix: '/api/v1' },
  );

  return app;
}

export type ApiApp = Awaited<ReturnType<typeof buildApiApp>>;
