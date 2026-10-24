import type { FastifyInstance } from 'fastify';

import { ApiError } from '../errors/api-errors.js';

const MAX_BODY_BYTES = 1_048_576;

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
      return;
    }

    if (typeof error === 'object' && error !== null && 'validation' in error) {
      reply.status(400).send({
        error: 'Requisição inválida',
        code: 'VALIDATION_ERROR',
        details: (error as { validation: unknown }).validation,
      });
      return;
    }

    request.log.error({ err: error }, 'Erro não tratado na API');
    reply.status(500).send({
      error: 'Erro interno do servidor',
      code: 'INTERNAL_ERROR',
    });
  });

  app.addHook('preParsing', async (request, _reply, payload) => {
    const contentLength = request.headers['content-length'];
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede 1 MB');
    }
    return payload;
  });
}
