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
});
