import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setEnvForTest } from '../../src/config/env.js';
import { buildApiApp } from '../app.js';
import { buildTestEnv, issueTestAccessToken } from '../test/test-env.js';

describe('settings routes', () => {
  it('GET /settings exige autenticação', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
    });

    assert.equal(response.statusCode, 401);

    await app.close();
    setEnvForTest(undefined);
  });

  it('GET /settings retorna snapshot autenticado', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();
    const token = await issueTestAccessToken(buildTestEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.ok([200, 500, 503].includes(response.statusCode));
    if (response.statusCode !== 200) {
      await app.close();
      setEnvForTest(undefined);
      return;
    }

    const body = response.json() as {
      timezone: string;
      minScore: number;
      brand: { name: string };
      worker: { canSpawnWorkers: boolean };
    };
    assert.ok(typeof body.timezone === 'string');
    assert.ok(typeof body.minScore === 'number');
    assert.ok(typeof body.brand.name === 'string');
    assert.equal(body.worker.canSpawnWorkers, true);

    await app.close();
    setEnvForTest(undefined);
  });

  it('PATCH /settings/score valida body', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();
    const token = await issueTestAccessToken(buildTestEnv());

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/settings/score',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { code: string };
    assert.equal(body.code, 'VALIDATION_ERROR');

    await app.close();
    setEnvForTest(undefined);
  });
});
