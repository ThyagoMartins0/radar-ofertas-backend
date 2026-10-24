import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';

import { env } from '../src/config/env.js';
import { ApiError } from './errors/api-errors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerApiRoutes } from './routes/index.js';

const DEFAULT_PANEL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://rdofertas.simplapp.com.br',
];

/** Gravado no Dockerfile — confirma se o deploy novo subiu. */
function readBuildTime(): string | null {
  try {
    return readFileSync('/app/BUILD_TIME', 'utf8').trim();
  } catch {
    return null;
  }
}

const BUILD_TIME = readBuildTime();

function resolveCorsOrigins(): string[] {
  return [...new Set([...DEFAULT_PANEL_ORIGINS, ...env.API_CORS_ORIGINS])];
}

export async function buildApiApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });

  registerErrorHandler(app);

  // PATCH/POST sem corpo (ex.: toggle) chegam sem Content-Type, mas às vezes com corpo vazio via proxy —
  // sem este parser o Fastify responde 415. Corpo não vazio com tipo desconhecido continua 415.
  app.addContentTypeParser('*', (_request, payload, done) => {
    let size = 0;
    payload.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });
    payload.on('end', () => {
      if (size === 0) {
        done(null, undefined);
        return;
      }
      done(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo como application/json'), undefined);
    });
    payload.on('error', (error) => done(error, undefined));
  });

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

  // Probe do proxy (Dokploy/Coolify healthcheck em GET /). Sem banco.
  app.get('/', async () => ({
    status: 'ok' as const,
    service: 'radar-ofertas-api',
    build: BUILD_TIME,
  }));

  return app;
}

export type ApiApp = Awaited<ReturnType<typeof buildApiApp>>;
