import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

import { NotFoundError, ValidationError } from '../errors/api-errors.js';
import { registerErrorHandler } from './error-handler.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  app.get('/api-error', () => {
    throw new NotFoundError('Oferta não encontrada');
  });

  app.get('/validation-error', () => {
    throw new ValidationError('Campo inválido', { field: 'score' });
  });

  app.get('/unexpected', () => {
    throw new Error('boom');
  });

  app.post('/large', async (_request, reply) => {
    reply.status(200).send({ ok: true });
  });

  await app.ready();
  return app;
}

describe('errorHandlerPlugin', () => {
  it('serializa ApiError com code e status', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api-error' });

    assert.equal(response.statusCode, 404);
    const body = response.json() as { error: string; code: string };
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.error, 'Oferta não encontrada');

    await app.close();
  });

  it('serializa ValidationError com details', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/validation-error' });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { code: string; details?: { field: string } };
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(body.details?.field, 'score');

    await app.close();
  });

  it('mapeia erros genéricos para 500 INTERNAL_ERROR', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/unexpected' });

    assert.equal(response.statusCode, 500);
    const body = response.json() as { code: string; error: string };
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.match(body.error, /interno/i);

    await app.close();
  });

  it('rejeita payload acima de 1 MB', async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/large',
      headers: { 'content-length': String(1_048_577) },
      payload: '{}',
    });

    assert.equal(response.statusCode, 413);
    const body = response.json() as { code: string };
    assert.equal(body.code, 'PAYLOAD_TOO_LARGE');

    await app.close();
  });
});
