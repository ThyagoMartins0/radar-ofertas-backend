import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildApiApp } from '../app.js';
import { buildOpenApiSpec } from '../openapi/spec.js';

describe('OpenAPI spec', () => {
  it('lista rotas principais da API', () => {
    const spec = buildOpenApiSpec();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/health']?.get);
    assert.ok(spec.paths['/health/collector']?.get);
    assert.ok(spec.paths['/health/worker']?.get);
    assert.ok(spec.paths['/offers']?.get);
    assert.ok(spec.paths['/settings']?.get);
    assert.ok(spec.paths['/accounts']?.get);
    const loginPost = spec.paths['/auth/login']?.post as { security?: unknown } | undefined;
    const dashboardGet = spec.paths['/dashboard']?.get as { security?: unknown } | undefined;
    assert.equal(loginPost?.security, undefined);
    assert.deepEqual(dashboardGet?.security, [{ bearerAuth: [] }]);
  });

  it('GET /api/v1/openapi.json retorna o contrato', async () => {
    const app = await buildApiApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /json/);

    const body = response.json() as { openapi: string; paths: Record<string, unknown> };
    assert.equal(body.openapi, '3.1.0');
    assert.ok(body.paths['/logs']);
  });
});
