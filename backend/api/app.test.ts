import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setEnvForTest } from '../src/config/env.js';
import { buildApiApp } from './app.js';
import { buildTestEnv } from './test/test-env.js';

describe('API probe', () => {
  it('GET / responde sem autenticação e sem banco', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({ method: 'GET', url: '/' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'ok',
      service: 'radar-ofertas-api',
    });

    await app.close();
  });

  it('OPTIONS /api/v1/auth/login permite o painel público', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: {
        origin: 'https://rdofertas.simplapp.com.br',
        'access-control-request-method': 'POST',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'https://rdofertas.simplapp.com.br');

    await app.close();
  });
});
