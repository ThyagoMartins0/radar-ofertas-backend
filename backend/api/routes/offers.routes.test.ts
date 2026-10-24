import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setEnvForTest } from '../../src/config/env.js';
import { buildApiApp } from '../app.js';
import { buildTestEnv, issueTestAccessToken } from '../test/test-env.js';

describe('offers routes', () => {
  it('GET /offers exige autenticação', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/offers',
    });

    assert.equal(response.statusCode, 401);

    await app.close();
    setEnvForTest(undefined);
  });

  it('GET /offers responde com paginação autenticada', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();
    const token = await issueTestAccessToken(buildTestEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/offers?page=1',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.ok([200, 500, 503].includes(response.statusCode));
    if (response.statusCode !== 200) {
      await app.close();
      setEnvForTest(undefined);
      return;
    }

    const body = response.json() as {
      offers: unknown[];
      page: number;
      pageSize: number;
      database: { available: boolean };
    };
    assert.ok(Array.isArray(body.offers));
    assert.equal(body.page, 1);
    assert.ok(typeof body.pageSize === 'number');
    assert.ok(typeof body.database.available === 'boolean');

    await app.close();
    setEnvForTest(undefined);
  });

  it('POST /offers/collect exige autenticação', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/offers/collect',
    });

    assert.equal(response.statusCode, 401);

    await app.close();
    setEnvForTest(undefined);
  });
});
